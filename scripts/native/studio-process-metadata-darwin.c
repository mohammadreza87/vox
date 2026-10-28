/* FRO1 ABI1: bounded read-only metadata for one explicitly named process.
 * Never reads argv/environment, signals processes, or changes files. */
#define _DARWIN_C_SOURCE 1
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#endif

#define OUTPUT_LIMIT 16384
#define PID_LIMIT 64
static char output[OUTPUT_LIMIT];
static size_t used;
static int overflow;

static void append(const char *format, ...) {
  if (overflow) return;
  va_list args;
  va_start(args, format);
  int n = vsnprintf(output + used, sizeof(output) - used, format, args);
  va_end(args);
  if (n < 0 || (size_t)n >= sizeof(output) - used) { overflow = 1; return; }
  used += (size_t)n;
}

static void json_string(const char *s) {
  append("\"");
  for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
    if (*p == '"' || *p == '\\') append("\\%c", *p);
    else if (*p < 32) append("\\u%04x", (unsigned)*p);
    else append("%c", *p);
  }
  append("\"");
}

static int result(const char *status, int code) {
  printf("{\"version\":1,\"status\":\"%s\"}\n", status);
  return code;
}

#ifdef __APPLE__
static int pid_list(uint32_t type, uint32_t parent, pid_t *values, size_t *count) {
  pid_t buffer[PID_LIMIT + 1];
  memset(buffer, 0, sizeof(buffer));
  errno = 0;
  int bytes = proc_listpids(type, parent, buffer, (int)sizeof(buffer));
  if (bytes < 0 || (bytes == 0 && errno != 0) || bytes % (int)sizeof(pid_t) != 0) return -1;
  if (bytes >= (int)sizeof(buffer)) return -2;
  *count = 0;
  for (int i = 0; i < bytes / (int)sizeof(pid_t); ++i) {
    if (buffer[i] == 0) continue;
    if (buffer[i] < 0 || *count == PID_LIMIT) return -2;
    for (size_t j = 0; j < *count; ++j) if (values[j] == buffer[i]) return -1;
    values[(*count)++] = buffer[i];
  }
  return 0;
}

static void json_pids(const pid_t *values, size_t count) {
  append("[");
  for (size_t i = 0; i < count; ++i) append("%s%d", i ? "," : "", values[i]);
  append("]");
}

/* A separate, synthetic-only observation mode. It never changes ABI1's
 * numeric-PID response and makes no claim about dead launch attempts. */
#define CENSUS_PID_LIMIT 4096
#define CENSUS_MATCH_LIMIT 16
struct census_process {
  pid_t pid, ppid, pgid;
  uid_t uid;
  uint64_t ticks, seconds, micros, cwd_dev, cwd_ino;
  int role;
};
static struct census_process census_first[CENSUS_PID_LIMIT], census_second[CENSUS_PID_LIMIT];

static int census_decimal(const char *text, uint64_t *value) {
  size_t length = strlen(text);
  if (!length || length > 20 || (length > 1 && text[0] == '0')) return 0;
  uint64_t number = 0;
  for (const unsigned char *p = (const unsigned char *)text; *p; ++p) {
    if (*p < '0' || *p > '9' || number > (UINT64_MAX - (*p - '0')) / 10) return 0;
    number = number * 10 + (*p - '0');
  }
  *value = number;
  return 1;
}

static int census_stamp_equal(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_uid == b->st_uid &&
    a->st_mode == b->st_mode && a->st_size == b->st_size && a->st_nlink == b->st_nlink &&
    a->st_birthtimespec.tv_sec == b->st_birthtimespec.tv_sec && a->st_birthtimespec.tv_nsec == b->st_birthtimespec.tv_nsec &&
    a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
    a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
}

static int census_path(const char *path, int directory, struct stat *value) {
  char canonical[PATH_MAX];
  if (path[0] != '/' || strlen(path) >= sizeof(canonical) || !realpath(path, canonical) || strcmp(path, canonical) ||
      lstat(path, value) != 0 || S_ISLNK(value->st_mode)) return 0;
  if (directory) return S_ISDIR(value->st_mode) && value->st_uid == geteuid() && (value->st_mode & 0777) == 0700;
  return S_ISREG(value->st_mode) && value->st_nlink == 1 && !(value->st_mode & 0022) && (value->st_mode & 0100);
}

static int census_fixture_paths(const char *base, const char *artifact) {
  const char *prefix = "/private/tmp/vox-mi1-b-";
  size_t length = strlen(prefix);
  if (strlen(base) != length + 6 + 5 || strncmp(base, prefix, length) || strcmp(base + length + 6, "/base")) return 0;
  for (size_t i = length; i < length + 6; ++i)
    if (!((base[i] >= 'a' && base[i] <= 'z') || (base[i] >= 'A' && base[i] <= 'Z') || (base[i] >= '0' && base[i] <= '9'))) return 0;
  return strlen(artifact) == length + 6 + 9 && !strncmp(base, artifact, length + 6) && !strcmp(artifact + length + 6, "/artifact");
}

static int census_time(struct timespec *value) { return clock_gettime(CLOCK_MONOTONIC, value) == 0; }
static int census_in_time(const struct timespec *start) {
  struct timespec now;
  if (!census_time(&now)) return 0;
  return now.tv_sec >= start->tv_sec && (now.tv_sec - start->tv_sec) * 1000000000LL + now.tv_nsec - start->tv_nsec < 2000000000LL;
}

static int census_order(const void *a, const void *b) {
  const struct census_process *left = a, *right = b;
  return (left->pid > right->pid) - (left->pid < right->pid);
}
static int census_equal(const struct census_process *a, const struct census_process *b) {
  return a->pid == b->pid && a->ppid == b->ppid && a->pgid == b->pgid && a->uid == b->uid &&
    a->ticks == b->ticks && a->seconds == b->seconds && a->micros == b->micros &&
    a->cwd_dev == b->cwd_dev && a->cwd_ino == b->cwd_ino && a->role == b->role;
}

/* Returns only fixed status codes. No failed or unrelated metadata escapes. */
static int census_scan(const char *node, const char *base, const char *artifact,
    const struct stat *base_stat, const struct stat *artifact_stat, const struct timespec *start,
    struct census_process *nodes, size_t *node_count) {
  pid_t pids[CENSUS_PID_LIMIT + 1];
  memset(pids, 0, sizeof(pids));
  errno = 0;
  int bytes = proc_listpids(PROC_UID_ONLY, geteuid(), pids, (int)sizeof(pids));
  if (bytes < 0 || !bytes || bytes % (int)sizeof(pid_t)) return 4;
  if (bytes >= (int)sizeof(pids)) return 6;
  *node_count = 0;
  size_t matched = 0;
  for (int i = 0; i < bytes / (int)sizeof(pid_t); ++i) {
    if (!census_in_time(start)) return 4;
    if (pids[i] <= 0) return 64;
    for (int j = 0; j < i; ++j) if (pids[j] == pids[i]) return 64;
    struct rusage_info_v0 birth_before, birth_after;
    struct proc_bsdinfo bsd_before, bsd_after;
    struct proc_vnodepathinfo vnode;
    char executable[PROC_PIDPATHINFO_MAXSIZE], executable_after[PROC_PIDPATHINFO_MAXSIZE];
    memset(&birth_before, 0, sizeof(birth_before)); memset(&birth_after, 0, sizeof(birth_after));
    memset(&bsd_before, 0, sizeof(bsd_before)); memset(&bsd_after, 0, sizeof(bsd_after));
    memset(&vnode, 0, sizeof(vnode)); memset(executable, 0, sizeof(executable)); memset(executable_after, 0, sizeof(executable_after));
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V0, (rusage_info_t *)&birth_before) != 0 ||
        proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &bsd_before, sizeof(bsd_before)) != (int)sizeof(bsd_before) ||
        bsd_before.pbi_pid != (uint32_t)pids[i] || bsd_before.pbi_uid != geteuid() ||
        !birth_before.ri_proc_start_abstime || birth_before.ri_proc_exit_abstime ||
        proc_pidpath(pids[i], executable, sizeof(executable)) <= 0 || !memchr(executable, 0, sizeof(executable)) || executable[0] != '/') return 4;
    int is_node = !strcmp(executable, node), role = 0;
    if (is_node) {
      if (proc_pidinfo(pids[i], PROC_PIDVNODEPATHINFO, 0, &vnode, sizeof(vnode)) != (int)sizeof(vnode) ||
          !memchr(vnode.pvi_cdir.vip_path, 0, sizeof(vnode.pvi_cdir.vip_path)) || vnode.pvi_cdir.vip_path[0] != '/') return 4;
      if (!strcmp(vnode.pvi_cdir.vip_path, base)) {
        if ((uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_dev != (uint64_t)base_stat->st_dev || (uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_ino != (uint64_t)base_stat->st_ino) return 5;
        role = 1;
      } else if (!strcmp(vnode.pvi_cdir.vip_path, artifact)) {
        if ((uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_dev != (uint64_t)artifact_stat->st_dev || (uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_ino != (uint64_t)artifact_stat->st_ino) return 5;
        role = 2;
      } else if (((uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_dev == (uint64_t)base_stat->st_dev && (uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_ino == (uint64_t)base_stat->st_ino) ||
                 ((uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_dev == (uint64_t)artifact_stat->st_dev && (uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_ino == (uint64_t)artifact_stat->st_ino)) return 5;
    }
    if (proc_pidpath(pids[i], executable_after, sizeof(executable_after)) <= 0 || !memchr(executable_after, 0, sizeof(executable_after)) ||
        strcmp(executable, executable_after) || proc_pid_rusage(pids[i], RUSAGE_INFO_V0, (rusage_info_t *)&birth_after) != 0 ||
        proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &bsd_after, sizeof(bsd_after)) != (int)sizeof(bsd_after)) return 5;
    if (birth_before.ri_proc_start_abstime != birth_after.ri_proc_start_abstime || birth_after.ri_proc_exit_abstime ||
        bsd_before.pbi_pid != bsd_after.pbi_pid || bsd_before.pbi_ppid != bsd_after.pbi_ppid || bsd_before.pbi_uid != bsd_after.pbi_uid ||
        bsd_before.pbi_pgid != bsd_after.pbi_pgid || bsd_before.pbi_start_tvsec != bsd_after.pbi_start_tvsec ||
        bsd_before.pbi_start_tvusec != bsd_after.pbi_start_tvusec) return 5;
    if (is_node) {
      if (*node_count >= CENSUS_PID_LIMIT || (role && ++matched > CENSUS_MATCH_LIMIT)) return 6;
      struct census_process row = {0};
      row.pid = pids[i]; row.ppid = (pid_t)bsd_before.pbi_ppid; row.uid = bsd_before.pbi_uid; row.pgid = (pid_t)bsd_before.pbi_pgid;
      row.ticks = birth_before.ri_proc_start_abstime; row.seconds = bsd_before.pbi_start_tvsec; row.micros = bsd_before.pbi_start_tvusec;
      row.cwd_dev = vnode.pvi_cdir.vip_vi.vi_stat.vst_dev; row.cwd_ino = vnode.pvi_cdir.vip_vi.vi_stat.vst_ino; row.role = role;
      if (row.ppid < 0 || row.pgid <= 0 || !row.seconds || row.micros >= 1000000) return 4;
      nodes[(*node_count)++] = row;
    }
  }
  qsort(nodes, *node_count, sizeof(*nodes), census_order);
  return census_in_time(start) ? 0 : 4;
}

static int current_fixture_census(int argc, char **argv) {
  if (argc != 9 || !census_fixture_paths(argv[3], argv[4])) return result("invalid", 64);
  uint64_t base_dev, base_ino, artifact_dev, artifact_ino;
  if (!census_decimal(argv[5], &base_dev) || !census_decimal(argv[6], &base_ino) || !base_ino ||
      !census_decimal(argv[7], &artifact_dev) || !census_decimal(argv[8], &artifact_ino) || !artifact_ino) return result("invalid", 64);
  struct stat node_before, base_before, artifact_before, node_after, base_after, artifact_after;
  if (!census_path(argv[2], 0, &node_before) || !census_path(argv[3], 1, &base_before) || !census_path(argv[4], 1, &artifact_before)) return result("unavailable", 4);
  if ((uint64_t)base_before.st_dev != base_dev || (uint64_t)base_before.st_ino != base_ino ||
      (uint64_t)artifact_before.st_dev != artifact_dev || (uint64_t)artifact_before.st_ino != artifact_ino ||
      (base_dev == artifact_dev && base_ino == artifact_ino)) return result("changed", 5);
  struct timespec start;
  if (!census_time(&start)) return result("unavailable", 4);
  size_t first_count, second_count;
  int code = census_scan(argv[2], argv[3], argv[4], &base_before, &artifact_before, &start, census_first, &first_count);
  if (!code) code = census_scan(argv[2], argv[3], argv[4], &base_before, &artifact_before, &start, census_second, &second_count);
  if (code) return result(code == 6 ? "overflow" : code == 64 ? "invalid" : code == 5 ? "changed" : "unavailable", code);
  if (first_count != second_count) return result("changed", 5);
  for (size_t i = 0; i < first_count; ++i) if (!census_equal(&census_first[i], &census_second[i])) return result("changed", 5);
  if (
      !census_path(argv[2], 0, &node_after) || !census_path(argv[3], 1, &base_after) || !census_path(argv[4], 1, &artifact_after) ||
      !census_stamp_equal(&node_before, &node_after) || !census_stamp_equal(&base_before, &base_after) ||
      !census_stamp_equal(&artifact_before, &artifact_after) || !census_in_time(&start)) return result("changed", 5);
  append("{\"version\":1,\"status\":\"complete\",\"uid\":%u,\"baseDevice\":\"%" PRIu64 "\",\"baseInode\":\"%" PRIu64 "\",\"artifactDevice\":\"%" PRIu64 "\",\"artifactInode\":\"%" PRIu64 "\",\"matches\":[",
      (unsigned)geteuid(), base_dev, base_ino, artifact_dev, artifact_ino);
  int emitted = 0;
  for (size_t i = 0; i < first_count; ++i) {
    const struct census_process *row = &census_first[i];
    if (!row->role) continue;
    append("%s{\"identity\":[%d,%d,%u,%d,\"%" PRIu64 "\",\"%" PRIu64 "\",\"%" PRIu64 "\"],\"cwd\":\"%s\"}",
        emitted++ ? "," : "", row->pid, row->ppid, (unsigned)row->uid, row->pgid, row->ticks, row->seconds, row->micros, row->role == 1 ? "base" : "artifact");
  }
  append("]}\n");
  if (overflow) return result("overflow", 6);
  return fwrite(output, 1, used, stdout) == used ? 0 : 4;
}
#endif

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "--current-fixture-census-v1")) {
#ifdef __APPLE__
    return current_fixture_census(argc, argv);
#else
    return result("unavailable", 4);
#endif
  }
  if (argc != 2 || !argv[1][0] || strlen(argv[1]) > 10) return result("invalid", 64);
  uint64_t parsed = 0;
  for (const unsigned char *p = (const unsigned char *)argv[1]; *p; ++p) {
    if (*p < '0' || *p > '9') return result("invalid", 64);
    parsed = parsed * 10 + (*p - '0');
    if (parsed > INT_MAX) return result("invalid", 64);
  }
  if (!parsed || argv[1][0] == '0') return result("invalid", 64);
#ifndef __APPLE__
  return result("unavailable", 4);
#else
  const pid_t pid = (pid_t)parsed;
  struct rusage_info_v0 birth_before, birth_after;
  struct proc_bsdinfo bsd_before, bsd_after;
  struct proc_vnodepathinfo vnode;
  char executable[PROC_PIDPATHINFO_MAXSIZE];
  pid_t children[PID_LIMIT], group[PID_LIMIT];
  size_t child_count = 0, group_count = 0;
  memset(&birth_before, 0, sizeof(birth_before));
  memset(&birth_after, 0, sizeof(birth_after));
  memset(&bsd_before, 0, sizeof(bsd_before));
  memset(&bsd_after, 0, sizeof(bsd_after));
  memset(&vnode, 0, sizeof(vnode));
  memset(executable, 0, sizeof(executable));
  errno = 0;
  if (proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&birth_before) != 0) {
    if (errno != ESRCH) return result("unavailable", 4);
    int absent_group = pid_list(PROC_PGRP_ONLY, (uint32_t)pid, group, &group_count);
    if (absent_group == -2) return result("overflow", 6);
    if (absent_group) return result("unavailable", 4);
    /* Refuse PID reuse while group membership was observed. */
    errno = 0;
    if (proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&birth_after) == 0 || errno != ESRCH)
      return result("changed", 5);
    append("{\"version\":1,\"status\":\"absent\",\"processGroupPids\":");
    json_pids(group, group_count); append("}\n");
    if (overflow) return result("overflow", 6);
    return fwrite(output, 1, used, stdout) == used ? 3 : 4;
  }
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd_before, sizeof(bsd_before)) != (int)sizeof(bsd_before) ||
      bsd_before.pbi_pid != (uint32_t)pid || bsd_before.pbi_uid != geteuid() ||
      !birth_before.ri_proc_start_abstime || birth_before.ri_proc_exit_abstime)
    return result("unavailable", 4);
  if (proc_pidpath(pid, executable, sizeof(executable)) <= 0 ||
      !memchr(executable, 0, sizeof(executable)) || executable[0] != '/' ||
      proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &vnode, sizeof(vnode)) != (int)sizeof(vnode) ||
      !memchr(vnode.pvi_cdir.vip_path, 0, sizeof(vnode.pvi_cdir.vip_path)) || vnode.pvi_cdir.vip_path[0] != '/')
    return result("unavailable", 4);
  int children_result = pid_list(PROC_PPID_ONLY, (uint32_t)pid, children, &child_count);
  int group_result = pid_list(PROC_PGRP_ONLY, bsd_before.pbi_pgid, group, &group_count);
  if (children_result == -2 || group_result == -2) return result("overflow", 6);
  if (children_result || group_result) return result("unavailable", 4);
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd_after, sizeof(bsd_after)) != (int)sizeof(bsd_after) ||
      proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&birth_after) != 0)
    return result("changed", 5);
  if (birth_before.ri_proc_start_abstime != birth_after.ri_proc_start_abstime || birth_after.ri_proc_exit_abstime ||
      bsd_before.pbi_pid != bsd_after.pbi_pid || bsd_before.pbi_ppid != bsd_after.pbi_ppid ||
      bsd_before.pbi_uid != bsd_after.pbi_uid || bsd_before.pbi_pgid != bsd_after.pbi_pgid ||
      bsd_before.pbi_start_tvsec != bsd_after.pbi_start_tvsec || bsd_before.pbi_start_tvusec != bsd_after.pbi_start_tvusec)
    return result("changed", 5);
  append("{\"version\":1,\"status\":\"ok\",\"pid\":%d,\"ppid\":%u,\"uid\":%u,\"pgid\":%u,", pid,
    bsd_before.pbi_ppid, bsd_before.pbi_uid, bsd_before.pbi_pgid);
  append("\"startAbsTicks\":\"%" PRIu64 "\",\"startSeconds\":\"%" PRIu64 "\",\"startMicroseconds\":\"%" PRIu64 "\",",
    birth_before.ri_proc_start_abstime, bsd_before.pbi_start_tvsec, bsd_before.pbi_start_tvusec);
  append("\"executablePath\":"); json_string(executable);
  append(",\"cwdPath\":"); json_string(vnode.pvi_cdir.vip_path);
  append(",\"cwdDevice\":\"%" PRIu64 "\",\"cwdInode\":\"%" PRIu64 "\",\"childPids\":",
    (uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_dev, (uint64_t)vnode.pvi_cdir.vip_vi.vi_stat.vst_ino);
  json_pids(children, child_count); append(",\"processGroupPids\":"); json_pids(group, group_count); append("}\n");
  if (overflow) return result("overflow", 6);
  if (fwrite(output, 1, used, stdout) != used) return 4;
  return 0;
#endif
}

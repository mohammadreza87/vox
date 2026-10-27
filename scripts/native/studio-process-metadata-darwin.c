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
#endif

int main(int argc, char **argv) {
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

#!/usr/bin/env python3
"""Offline, self-only speaker encoder on a private Unix socket.

The encoder is real; speaker enrollment is NOT qualified by an encoder smoke test.
This release has no qualified live/overlap/replay/synthetic inspector, so /inspect
abstains before speaker extraction. Operator JSON cannot override that fact.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import hmac
import io
import json
import math
import os
from pathlib import Path
import secrets
import selectors
import signal
import socket
import socketserver
import stat
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler

SOURCE = Path(__file__).resolve().parent
MODEL = json.loads((SOURCE / "model.json").read_text())
MAX_AUDIO = 1_000_000
MAX_TEMPLATE = 65_536
MAX_BODY = 1_500_000
MAX_RESPONSE = 100_000
MIMES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav"}

class Rejected(Exception):
    pass


def private_file(path: Path, minimum=1, maximum=65_536) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(descriptor)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077 or not minimum <= st.st_size <= maximum:
            raise Rejected("private_file_required")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        if not minimum <= len(data) <= maximum: raise Rejected("private_file_required")
        return data
    finally:
        os.close(descriptor)


def private_directory(path: Path):
    st = path.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise Rejected("private_directory_required")


def deny_network(event, args):
    if event == "socket.connect" and isinstance(args[1], tuple):
        raise Rejected("outbound_network_denied")


def exact_object(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise Rejected("invalid_request")
    return value


def decode_base64(value, maximum):
    if not isinstance(value, str) or len(value) > ((maximum + 2) // 3) * 4:
        raise Rejected("invalid_request")
    try:
        result = bytearray(base64.b64decode(value, validate=True))
    except Exception:
        raise Rejected("invalid_request") from None
    if not 0 < len(result) <= maximum:
        raise Rejected("invalid_request")
    return result


def decode_audio(audio, mime, max_duration_ms, executable):
    """No files or network protocols; cap decoded bytes while reading, not after."""
    if mime.split(";")[0] not in MIMES or not 0 < len(audio) <= MAX_AUDIO or not 0 < max_duration_ms <= 10_000:
        raise Rejected("invalid_audio")
    command = [executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
               "-protocol_whitelist", "pipe", "-format_whitelist", "wav,ogg,matroska,webm,mov,mp4", "-i", "pipe:0",
               "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               close_fds=True, env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent"})
    def send():
        try:
            process.stdin.write(audio)
        except (BrokenPipeError, OSError):
            pass
        finally:
            try: process.stdin.close()
            except OSError: pass
    writer = threading.Thread(target=send, daemon=True)
    writer.start()
    limit = int((max_duration_ms + 100) * 16_000 / 1000) * 4
    output = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "out")
    selector.register(process.stderr, selectors.EVENT_READ, "err")
    deadline = time.monotonic() + 4.0
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                raise Rejected("decode_timeout")
            for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                block = os.read(key.fileobj.fileno(), 16_384)
                if not block:
                    selector.unregister(key.fileobj)
                elif key.data == "out":
                    if len(output) + len(block) > limit:
                        raise Rejected("audio_too_long")
                    output.extend(block)
                # Decoder diagnostics may contain payload-derived text: discard.
        if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0 or not output or len(output) % 4:
            raise Rejected("invalid_audio")
        return output
    except Exception:
        output[:] = b"\0" * len(output)
        raise
    finally:
        selector.close()
        if process.poll() is None: process.kill()
        process.wait()
        writer.join(timeout=0.2)
        process.stdout.close(); process.stderr.close()


class Encoder:
    def __init__(self, directory: Path, threads=2):
        weights = directory / MODEL["weightsFile"]
        if weights.is_symlink() or not weights.is_file() or weights.stat().st_size != MODEL["weightsBytes"]:
            raise Rejected("model_artifact_missing")
        digest = hashlib.sha256()
        with weights.open("rb") as f:
            for chunk in iter(lambda: f.read(1_048_576), b""): digest.update(chunk)
        if digest.hexdigest() != MODEL["weightsSha256"]:
            raise Rejected("model_digest_mismatch")
        # No HyperPyYAML, from_hparams, remote code or runtime downloads.
        import torch
        from speechbrain.lobes.features import Fbank
        from speechbrain.processing.features import InputNormalization
        from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN
        import imageio_ffmpeg
        self.torch = torch
        torch.set_num_threads(max(1, min(threads, 4)))
        graph = MODEL["graph"]
        self.features = Fbank(n_mels=graph["inputSize"]).eval()
        self.normalizer = InputNormalization(norm_type="sentence", std_norm=False).eval()
        self.model = ECAPA_TDNN(input_size=graph["inputSize"], channels=graph["channels"],
                               kernel_sizes=graph["kernelSizes"], dilations=graph["dilations"],
                               attention_channels=graph["attentionChannels"], lin_neurons=graph["linearNeurons"]).eval()
        self.model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True), strict=True)
        self.decoder = imageio_ffmpeg.get_ffmpeg_exe()

    def extract(self, audio, mime, duration=10_000):
        import numpy as np
        decoded = decode_audio(audio, mime, duration, self.decoder)
        try:
            data = np.frombuffer(decoded, dtype="<f4")
            if data.size < 16_000 or not np.isfinite(data).all(): raise Rejected("invalid_audio")
            waveform = self.torch.from_numpy(data.copy()).unsqueeze(0)
            with self.torch.inference_mode():
                lengths = self.torch.ones(1)
                features = self.normalizer(self.features(waveform), lengths)
                vector = self.model(features, lengths).reshape(-1)
                norm = self.torch.linalg.vector_norm(vector)
                if vector.numel() != MODEL["embeddingDimensions"] or not self.torch.isfinite(vector).all() or norm <= 0:
                    raise Rejected("invalid_embedding")
                result = (vector / norm).tolist()
                waveform.zero_(); vector.zero_(); features.zero_()
            return result
        finally:
            decoded[:] = b"\0" * len(decoded)


def encode_template(vector):
    return json.dumps({"schemaVersion": 1, "providerVersion": MODEL["providerVersion"],
                       "modelDigest": MODEL["weightsSha256"], "vector": vector}, separators=(",", ":")).encode()


def parse_template(data):
    try: value = json.loads(data)
    except Exception: raise Rejected("invalid_template") from None
    exact_object(value, ["schemaVersion", "providerVersion", "modelDigest", "vector"])
    vector = value["vector"]
    if value["schemaVersion"] != 1 or value["providerVersion"] != MODEL["providerVersion"] or value["modelDigest"] != MODEL["weightsSha256"]:
        raise Rejected("model_mismatch")
    if not isinstance(vector, list) or len(vector) != MODEL["embeddingDimensions"] or any(type(x) not in (float, int) or not math.isfinite(x) for x in vector):
        raise Rejected("invalid_template")
    norm = math.sqrt(sum(x*x for x in vector))
    if not 0.99 <= norm <= 1.01: raise Rejected("invalid_template")
    return vector


class QualityInspection:
    """Only bounded decoding is implemented; it does not establish speech/liveness.

    A separately reviewed local inspector must establish every check before
    returning eligible_single_live. No operator boolean substitutes for it.
    """
    qualified = False
    version = "decode-only-v1"
    def inspect(self, decoded, challenge):
        return {"challengeVerified": False, "singleLiveSpeaker": False,
                "replayRejected": False, "syntheticRejected": False}


class Runtime:
    def __init__(self, encoder, key, inspector=None, match_policy=None):
        self.encoder, self.key = encoder, key
        self.inspector = inspector or QualityInspection()
        self.match_policy = match_policy
        self.leases = {}
        self.lock = threading.Lock()

    def ready(self):
        qualified = self.inspector.qualified is True
        matching = self.match_policy is not None and self.match_policy["expiresAt"] > int(time.time() * 1000)
        return {"protocolVersion": 1, "providerId": MODEL["providerId"], "providerVersion": MODEL["providerVersion"],
                "modelDigest": MODEL["weightsSha256"], "encoderReady": self.encoder is not None,
                "inspectionQualified": qualified, "matchingQualified": matching,
                "reason": "inspection_not_qualified" if not qualified else "matching_not_qualified" if not matching else "ready"}

    def operate(self, path, value):
        if path == "/ready":
            exact_object(value, []); return self.ready()
        if path == "/inspect":
            exact_object(value, ["audio", "mimeType", "challenge", "maxDurationMs"])
            if not isinstance(value["mimeType"], str) or not isinstance(value["challenge"], str) or not value["challenge"].isdigit() or len(value["challenge"]) != 6 or type(value["maxDurationMs"]) is not int:
                raise Rejected("invalid_request")
            audio = decode_base64(value["audio"], MAX_AUDIO)
            decoded = None
            try:
                decoded = decode_audio(audio, value["mimeType"], value["maxDurationMs"], self.encoder.decoder)
                inspection = self.inspector.inspect(decoded, value["challenge"])
                checks = ["challengeVerified", "singleLiveSpeaker", "replayRejected", "syntheticRejected"]
                if not self.inspector.qualified or not isinstance(inspection, dict) or not all(inspection.get(k) is True for k in checks):
                    return {"outcome": "unknown", "reason": "inspection_not_qualified"}
                lease = secrets.token_hex(32)
                with self.lock:
                    now = time.monotonic()
                    self.leases = {k:v for k,v in self.leases.items() if v["expires"] > now}
                    if len(self.leases) >= 32: raise Rejected("worker_busy")
                    self.leases[lease] = {"audioDigest": hashlib.sha256(audio).hexdigest(), "mime": value["mimeType"],
                                          "modelDigest": MODEL["weightsSha256"], "expires": now + 30,
                                          "duration": value["maxDurationMs"]}
                return {"outcome": "eligible_single_live", "inspectionLease": lease}
            finally:
                audio[:] = b"\0" * len(audio)
                if decoded is not None: decoded[:] = b"\0" * len(decoded)
        if path == "/extract":
            exact_object(value, ["audio", "mimeType", "inspectionLease"])
            if not isinstance(value["inspectionLease"], str) or len(value["inspectionLease"]) != 64:
                raise Rejected("inspection_required")
            with self.lock: lease = self.leases.pop(value["inspectionLease"], None)
            audio = decode_base64(value["audio"], MAX_AUDIO)
            template = None
            try:
                if not self.inspector.qualified or not lease or lease["expires"] <= time.monotonic() or lease["modelDigest"] != MODEL["weightsSha256"] or lease["mime"] != value["mimeType"] or not hmac.compare_digest(lease["audioDigest"], hashlib.sha256(audio).hexdigest()):
                    raise Rejected("inspection_required")
                template = bytearray(encode_template(self.encoder.extract(audio, value["mimeType"], lease["duration"])))
                return {"template": base64.b64encode(template).decode()}
            finally:
                audio[:] = b"\0" * len(audio)
                if template is not None: template[:] = b"\0" * len(template)
        if path == "/compare":
            exact_object(value, ["query", "candidates"])
            if not isinstance(value["candidates"], list) or len(value["candidates"]) != 1:
                raise Rejected("self_only_candidates_required")
            candidate = exact_object(value["candidates"][0], ["id", "template"])
            if candidate["id"] != "self": raise Rejected("self_only_candidates_required")
            query = decode_base64(value["query"], MAX_TEMPLATE)
            reference = decode_base64(candidate["template"], MAX_TEMPLATE)
            try:
                a, b = parse_template(query), parse_template(reference)
                if not self.inspector.qualified or not self.match_policy: return {}
                if self.match_policy["expiresAt"] <= int(time.time() * 1000): return {}
                score = sum(x*y for x,y in zip(a,b))
                return {"candidateId": "self"} if score >= self.match_policy["threshold"] else {}
            finally:
                query[:] = b"\0" * len(query); reference[:] = b"\0" * len(reference)
        if path == "/purge":
            exact_object(value, [])
            with self.lock: self.leases.clear()
            return {"purged": True}
        raise Rejected("unknown_operation")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *_): pass
    def do_POST(self):
        self.connection.settimeout(5)
        key = self.server.runtime.key
        actual = self.headers.get("Authorization", "")
        if not hmac.compare_digest(actual, "Bearer " + key): return self.respond(401, {"error": "authentication_required"})
        if self.path not in {"/ready", "/inspect", "/extract", "/compare", "/purge"}: return self.respond(404, {"error": "unknown_operation"})
        if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Type") != "application/json": return self.respond(400, {"error": "invalid_request"})
        try:
            raw_length = self.headers.get("Content-Length", "")
            if not raw_length.isdigit() or not 0 < int(raw_length) <= MAX_BODY: raise Rejected("invalid_request")
            raw = self.rfile.read(int(raw_length))
            if len(raw) != int(raw_length): raise Rejected("invalid_request")
            value = json.loads(raw)
            response = self.server.runtime.operate(self.path, value)
            return self.respond(200, response)
        except Rejected as error: return self.respond(422, {"error": str(error)})
        except Exception: return self.respond(400, {"error": "invalid_request"})
    def respond(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body))); self.send_header("Connection", "close"); self.end_headers()
        try: self.wfile.write(body)
        except OSError: pass
        self.close_connection = True


class Server(socketserver.UnixStreamServer):
    request_queue_size = 2
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        # An absolute connection deadline also bounds slow header/body trickles;
        # a per-recv socket timeout alone would reset for every small write.
        def expire():
            try: connection.shutdown(socket.SHUT_RDWR)
            except OSError: pass
        self.connection_deadline = threading.Timer(10, expire)
        self.connection_deadline.daemon = True
        self.connection_deadline.start()
        return connection, address
    def process_request(self, request, address):
        try: super().process_request(request, address)
        finally: self.connection_deadline.cancel()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["serve", "benchmark"])
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--socket", type=Path)
    parser.add_argument("--auth-key-file", type=Path)
    parser.add_argument("--match-policy-file", type=Path)
    args = parser.parse_args()
    os.environ.update({"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1"})
    sys.addaudithook(deny_network)
    encoder = Encoder(args.model_dir)
    if args.mode == "benchmark":
        import wave, struct
        data = bytearray()
        for i in range(3 * 16_000): data.extend(struct.pack("<h", int(9000 * math.sin(2 * math.pi * (180 + i / 320) * i / 16_000))))
        output = io.BytesIO()
        with wave.open(output, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16_000); w.writeframes(data)
        start = time.monotonic(); first = encoder.extract(output.getvalue(), "audio/wav"); elapsed = time.monotonic() - start
        second = encoder.extract(output.getvalue(), "audio/wav")
        score = sum(a*b for a,b in zip(first, second))
        print(json.dumps({"kind": "synthetic_signal_encoder_smoke", "modelDigest": MODEL["weightsSha256"],
                          "dimensions": len(first), "finite": all(math.isfinite(x) for x in first),
                          "sameSignalCosine": score, "elapsedSeconds": elapsed,
                          "recognitionAccuracyQualified": False, "inspectionQualified": False}))
        data[:] = b"\0" * len(data)
        return
    if args.socket is None or args.auth_key_file is None: raise Rejected("server_configuration_required")
    private_directory(args.socket.parent)
    if args.socket.exists() or args.socket.is_symlink(): raise Rejected("socket_already_exists")
    key = private_file(args.auth_key_file, 64, 65).decode().strip()
    if len(key) != 64 or any(c not in "0123456789abcdef" for c in key): raise Rejected("invalid_auth_key")
    policy = None
    if args.match_policy_file:
        policy = json.loads(private_file(args.match_policy_file).decode())
        exact_object(policy, ["modelDigest", "threshold", "qualificationReference", "expiresAt"])
        if policy["modelDigest"] != MODEL["weightsSha256"] or type(policy["threshold"]) not in (float,int) or not 0 < policy["threshold"] < 1 or not isinstance(policy["qualificationReference"], str) or not policy["qualificationReference"].strip() or type(policy["expiresAt"]) is not int or policy["expiresAt"] <= int(time.time()*1000):
            raise Rejected("invalid_match_policy")
    runtime = Runtime(encoder, key, match_policy=policy)
    def terminate(_signal, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    old = os.umask(0o077)
    try:
        with Server(str(args.socket), Handler) as server:
            os.chmod(args.socket, 0o600); server.runtime = runtime
            print(json.dumps({"ready": True, **runtime.ready()}), flush=True)
            server.serve_forever(poll_interval=0.2)
    finally:
        os.umask(old)
        try: args.socket.unlink()
        except FileNotFoundError: pass

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: pass
    except Exception: print(json.dumps({"error": "local_voice_start_failed"}), file=sys.stderr); sys.exit(1)

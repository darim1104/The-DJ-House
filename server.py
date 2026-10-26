# 캐시 없이 실행하는 서버:  python3 server.py   →  http://localhost:8123
# MP3 구간 이동(HOT CUE·스크래치 후 복귀)이 0초로 튀지 않도록 HTTP Range 요청(206 Partial Content)을 지원한다.
import http.server, os, re

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".mp3": "audio/mpeg"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self._range = None
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not header or os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()
        match = RANGE_RE.match(header.strip())
        size = os.path.getsize(path)
        if not match or (not match.group(1) and not match.group(2)):
            return super().send_head()
        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
        else:  # bytes=-N (마지막 N바이트)
            start = max(0, size - int(match.group(2)))
            end = size - 1
        end = min(end, size - 1)
        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(start)
        self._range = (start, end)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        if not getattr(self, "_range", None):
            return super().copyfile(source, outputfile)
        remaining = self._range[1] - self._range[0] + 1
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", 8123), H) as s:
        print("http://localhost:8123 에서 실행 중 (끄려면 control+C)")
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            pass

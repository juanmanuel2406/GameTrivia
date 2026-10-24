"""Local REST adapter for fakeredis with real Lua execution; never production."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import fakeredis

db = fakeredis.FakeRedis(decode_responses=True)
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        commands = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        results = []
        for command in commands:
            try:
                with lock:
                    result = db.execute_command(*command)
                if str(command[0]).upper() == 'HGETALL' and isinstance(result, dict):
                    result = [item for pair in result.items() for item in pair]
                if result is True and str(command[0]).upper() in ('SET', 'MSET'):
                    result = 'OK'
                results.append({'result': result})
            except Exception as error:
                results.append({'error': str(error)})
        body = json.dumps(results).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

class Server(ThreadingHTTPServer):
    request_queue_size = 256

server = Server(('127.0.0.1', 0), Handler)
print(server.server_port, flush=True)
server.serve_forever()

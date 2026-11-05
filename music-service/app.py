"""Authenticated music library for the static iwtxz site; Python 3.11+."""
import concurrent.futures
from contextlib import contextmanager
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote, parse_qs
from catalog import Catalog, CatalogError
from urllib.request import Request, urlopen

UUID = re.compile(r'^[a-f0-9]{32}$')
USER_ID = re.compile(r'^[a-f0-9-]{36}$')

class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def music_source(value):
    if not isinstance(value, str) or len(value) > 1000:
        raise ApiError(400, 'Укажи ссылку на трек.')
    try:
        parsed = urlsplit(value.strip())
        host = (parsed.hostname or '').lower()
        allowed = host in ('youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be', 'soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com', 'vimeo.com', 'www.vimeo.com') or bool(re.fullmatch(r'[a-z0-9-]+\.bandcamp\.com', host))
        if parsed.scheme != 'https' or not allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError()
        if not parsed.path or parsed.path == '/':
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError(400, 'Поддерживаются ссылки на трек YouTube, SoundCloud, Bandcamp или Vimeo.')
    return value.strip()

class Library:
    def __init__(self, directory, origin, supabase, public_key, downloader=None, minimum_free=350*1024*1024):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.media = self.root / 'media'; self.media.mkdir(exist_ok=True)
        self.origin, self.supabase, self.public_key = origin.rstrip('/'), supabase.rstrip('/'), public_key
        self.minimum_free = minimum_free
        self.downloader = downloader or self.download
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.lock = threading.RLock()
        self.auth_cache = {}
        with self.db() as db:
            db.executescript('''
              create table if not exists tracks(id text primary key, owner text not null, title text not null, url text not null, source text, duration real, bytes integer not null, created real not null, archived integer not null default 0);
              create index if not exists tracks_owner on tracks(owner);
              create table if not exists jobs(id text primary key, owner text not null, source text not null, state text not null, error text, track_id text, created real not null);
              create index if not exists jobs_owner on jobs(owner, created);
            ''')
            db.execute("update jobs set state='error',error='Сервер перезапустился. Добавь трек ещё раз.' where state in ('queued','downloading')")

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.root / 'library.sqlite', timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    def verify(self, token):
        if not isinstance(token, str) or not 10 < len(token) < 8192:
            raise ApiError(401, 'Войди в аккаунт ещё раз.')
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            cached = self.auth_cache.get(digest)
            if cached and cached[0] > time.time(): return cached[1]
        headers = {'apikey': self.public_key, 'Authorization': 'Bearer ' + token}
        try:
            with urlopen(Request(self.supabase + '/auth/v1/user', headers=headers), timeout=12) as response:
                user = json.load(response)
            owner = user.get('id', '')
            if not USER_ID.fullmatch(owner): raise ValueError()
            with urlopen(Request(self.supabase + '/rest/v1/profile_accounts?select=username&user_id=eq.' + owner, headers=headers), timeout=12) as response:
                account = json.load(response)
            if not isinstance(account, list) or len(account) != 1 or not account[0].get('username'): raise ValueError()
        except Exception:
            raise ApiError(401, 'Не удалось подтвердить аккаунт. Войди ещё раз.')
        with self.lock:
            self.auth_cache = {key: value for key, value in self.auth_cache.items() if value[0] > time.time()}
            if len(self.auth_cache) < 1000: self.auth_cache[digest] = (time.time() + 30, owner)
        return owner

    def list(self, owner):
        with self.db() as db:
            tracks = [dict(row) for row in db.execute('select id,title,url,source,duration,bytes,created from tracks where owner=? and archived=0 order by created desc', (owner,))]
            jobs = [dict(row) for row in db.execute("select id,source,state,error,track_id from jobs where owner=? and created>? and state!='ready' order by created desc limit 10", (owner, time.time()-3600))]
        return {'tracks': tracks, 'jobs': jobs}

    def enqueue(self, owner, value):
        source = music_source(value)
        with self.lock, self.db() as db:
            existing = db.execute('select id from tracks where owner=? and source=? and archived=0', (owner, source)).fetchone()
            if existing: return {'trackId': existing['id'], 'ready': True}
            active = db.execute("select id from jobs where owner=? and state in ('queued','downloading')", (owner,)).fetchone()
            if active: raise ApiError(409, 'Дождись загрузки предыдущего трека.')
            count, total = db.execute('select count(*),coalesce(sum(bytes),0) from tracks where owner=?', (owner,)).fetchone()
            if count >= 30 or total > 150*1024*1024: raise ApiError(409, 'Библиотека заполнена: максимум 30 треков или 150 МБ.')
            if db.execute('select count(*) from jobs where owner=? and created>?', (owner, time.time()-3600)).fetchone()[0] >= 8: raise ApiError(429, 'За час можно добавить 8 треков. Попробуй позже.')
            if db.execute("select count(*) from jobs where state in ('queued','downloading')").fetchone()[0] >= 12: raise ApiError(503, 'Сервер занят. Попробуй немного позже.')
            if shutil.disk_usage(self.root).free < self.minimum_free: raise ApiError(503, 'На музыкальном сервере пока нет свободного места.')
            job_id = uuid.uuid4().hex
            db.execute("insert into jobs(id,owner,source,state,created) values (?,?,?,'queued',?)", (job_id, owner, source, time.time()))
        self.pool.submit(self.run_job, owner, job_id, source)
        return {'jobId': job_id, 'ready': False}

    def run_job(self, owner, job_id, source):
        try:
            with self.db() as db: db.execute("update jobs set state='downloading' where id=?", (job_id,))
            with tempfile.TemporaryDirectory(prefix='import-', dir=self.root) as directory:
                metadata, path = self.downloader(source, Path(directory))
                size = path.stat().st_size
                if not 0 < size <= 24*1024*1024: raise ApiError(422, 'Трек слишком большой. Максимум — 24 МБ.')
                track_id = uuid.uuid4().hex
                destination = self.media / (track_id + '.mp3')
                shutil.move(str(path), destination)
                try:
                    with self.db() as db:
                        db.execute('insert into tracks(id,owner,title,url,source,duration,bytes,created) values (?,?,?,?,?,?,?,?)', (track_id,owner,str(metadata.get('title') or 'Без названия')[:100],self.origin+'/media/'+track_id+'.mp3',source,metadata.get('duration'),size,time.time()))
                        db.execute("update jobs set state='ready',track_id=? where id=?", (track_id,job_id))
                except Exception:
                    destination.unlink(missing_ok=True); raise
        except Exception as error:
            message = error.message if isinstance(error, ApiError) else 'Не удалось загрузить этот трек. Он может быть недоступен без входа или ограничен самим сервисом.'
            with self.db() as db: db.execute("update jobs set state='error',error=? where id=?", (message,job_id))
            logging.warning('Music import failed: %s', type(error).__name__)

    def download(self, source, directory):
        # Let each host use its available address family: YouTube metadata may use
        # IPv6 while its audio CDN can expose only IPv4. A global -4/-6 breaks one side.
        command = [os.environ.get('YTDLP_BIN', 'yt-dlp'), '--ignore-config', '--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--restrict-filenames', '--no-cache-dir', '--use-extractors', 'youtube:tab,youtube,soundcloud,soundcloud:set,bandcamp,vimeo', '--match-filter', 'duration <= 900 & !is_live', '--max-filesize', '32M', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '128K', '--write-info-json', '--no-write-playlist-metafiles', '-o', str(directory / 'track.%(ext)s'), '--', source]
        # Node/Deno is needed by current yt-dlp for YouTube's JavaScript challenges.
        js_runtime = os.environ.get('YTDLP_JS_RUNTIME', '')
        if js_runtime: command[1:1] = ['--js-runtimes', js_runtime]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=(os.name != 'nt'))
        try:
            result = process.wait(timeout=240)
        except subprocess.TimeoutExpired:
            if os.name != 'nt':
                import signal; os.killpg(process.pid, signal.SIGKILL)
            else: process.kill()
            process.wait(); raise ApiError(504, 'Загрузка заняла слишком много времени. Попробуй другой трек.')
        if result != 0 or not (directory/'track.mp3').is_file(): raise ApiError(422, 'Не удалось получить аудио. Сервис может быть недоступен с сервера или ограничивать этот трек. Попробуй другую ссылку.')
        metadata = json.loads((directory/'track.info.json').read_text(encoding='utf8'))
        return metadata, directory/'track.mp3'

    def remember(self, owner, data):
        url = data.get('url', '')
        prefix = self.supabase + '/storage/v1/object/public/profile-assets/' + owner + '/'
        if not isinstance(url, str) or not url.startswith(prefix) or len(url)>1000: raise ApiError(400, 'Можно добавить только свой загруженный файл.')
        path=unquote(urlsplit(url).path)
        if '\\' in path or any(part in ('.','..') for part in path.split('/')): raise ApiError(400, 'Неверный адрес файла.')
        with self.lock, self.db() as db:
            existing = db.execute('select id from tracks where owner=? and url=?', (owner,url)).fetchone()
            if existing:
                db.execute('update tracks set archived=0 where owner=? and id=?', (owner,existing['id']))
                return {'trackId': existing['id']}
            if db.execute('select count(*) from tracks where owner=?', (owner,)).fetchone()[0]>=30: raise ApiError(409, 'В библиотеке уже 30 треков.')
            track_id = uuid.uuid4().hex
            db.execute('insert into tracks(id,owner,title,url,bytes,created) values (?,?,?,?,0,?)', (track_id,owner,str(data.get('title') or 'Мой трек')[:100],url,time.time()))
        return {'trackId':track_id}

    def remove(self, owner, track_id):
        # Archive instead of breaking a URL already used by a published profile.
        if not isinstance(track_id,str) or not UUID.fullmatch(track_id): raise ApiError(400, 'Неверный трек.')
        with self.db() as db:
            result = db.execute('update tracks set archived=1 where owner=? and id=?', (owner,track_id))
            if not result.rowcount: raise ApiError(404, 'Трек не найден.')
        return {'ok':True}

def server(library, origins, host='127.0.0.1', port=8787):
    catalog=Catalog()
    class Handler(BaseHTTPRequestHandler):
        server_version = 'iwtxz-music'
        def setup(self):
            super().setup()
            self.connection.settimeout(20)
        def log_message(self, *_): pass
        def json(self, status, data):
            payload=json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(payload))); self.cors(); self.end_headers(); self.wfile.write(payload)
        def cors(self, media=False):
            origin=self.headers.get('Origin','')
            if media or origin in origins: self.send_header('Access-Control-Allow-Origin','*' if media else origin)
            self.send_header('Vary','Origin'); self.send_header('X-Content-Type-Options','nosniff')
        def do_OPTIONS(self):
            if self.headers.get('Origin') not in origins: return self.json(403,{'error':'Этот сайт не подключён к библиотеке.'})
            self.send_response(204); self.cors(); self.send_header('Access-Control-Allow-Headers','Authorization,Content-Type'); self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.send_header('Access-Control-Max-Age','600'); self.end_headers()
        def do_HEAD(self): self.handle_request(head=True)
        def do_GET(self): self.handle_request()
        def do_POST(self): self.handle_request()
        def handle_request(self, head=False):
            try:
                path=urlsplit(self.path).path
                if path=='/health' and self.command=='GET': return self.json(200,{'ok':True})
                match=re.fullmatch(r'/media/([a-f0-9]{32})\.mp3',path)
                if match and self.command in ('GET','HEAD'): return self.send_audio(match[1],head)
                if self.headers.get('Origin') and self.headers.get('Origin') not in origins: raise ApiError(403,'Этот сайт не подключён к библиотеке.')
                if path=='/v1/catalog/search' and self.command=='GET':
                    query=parse_qs(urlsplit(self.path).query)
                    try:return self.json(200,catalog.search(query.get('service',[''])[0],query.get('q',[''])[0]))
                    except CatalogError as error:raise ApiError(503,str(error))
                if path not in ('/v1/library','/v1/import','/v1/remember','/v1/remove'): raise ApiError(404,'Адрес не найден.')
                if self.command != ('GET' if path=='/v1/library' else 'POST'): raise ApiError(405,'Неверный метод.')
                authorization=self.headers.get('Authorization','')
                if not authorization.startswith('Bearer '): raise ApiError(401,'Нужно войти в аккаунт.')
                owner=library.verify(authorization[7:])
                if path=='/v1/library': return self.json(200,library.list(owner))
                length=int(self.headers.get('Content-Length','0'))
                if not 0 < length <=4096: raise ApiError(413,'Слишком большой запрос.')
                data=json.loads(self.rfile.read(length))
                if not isinstance(data,dict): raise ApiError(400,'Неверный запрос.')
                if path=='/v1/import': return self.json(202,library.enqueue(owner,data.get('url')))
                if path=='/v1/remember': return self.json(200,library.remember(owner,data))
                if path=='/v1/remove': return self.json(200,library.remove(owner,data.get('id')))
            except ApiError as error: self.json(error.status,{'error':error.message})
            except (ValueError,json.JSONDecodeError): self.json(400,{'error':'Неверный запрос.'})
            except (BrokenPipeError,ConnectionResetError): pass
            except Exception:
                logging.exception('Music API failed')
                self.json(500,{'error':'Библиотека временно недоступна.'})
        def send_audio(self, track_id, head):
            file=library.media/(track_id+'.mp3')
            if not file.is_file(): raise ApiError(404,'Аудиофайл не найден.')
            total=file.stat().st_size; start,end=0,total-1
            value=self.headers.get('Range')
            if value:
                match=re.fullmatch(r'bytes=(\d+)-(\d*)',value)
                if not match: raise ApiError(416,'Неверный диапазон.')
                start=int(match[1]); end=min(int(match[2]) if match[2] else end,end)
                if start>end: raise ApiError(416,'Неверный диапазон.')
            self.send_response(206 if value else 200); self.cors(media=True)
            self.send_header('Content-Type','audio/mpeg'); self.send_header('Accept-Ranges','bytes'); self.send_header('Cache-Control','public,max-age=31536000,immutable'); self.send_header('Content-Length',str(end-start+1))
            if value: self.send_header('Content-Range',f'bytes {start}-{end}/{total}')
            self.end_headers()
            if head:return
            with file.open('rb') as stream:
                stream.seek(start); remaining=end-start+1
                while remaining:
                    chunk=stream.read(min(65536,remaining))
                    if not chunk: break
                    self.wfile.write(chunk); remaining-=len(chunk)
    instance=ThreadingHTTPServer((host,port),Handler)
    instance.daemon_threads=True
    return instance

if __name__=='__main__':
    logging.basicConfig(level=logging.INFO)
    for executable in (os.environ.get('YTDLP_BIN','yt-dlp'),'ffmpeg'):
        if not shutil.which(executable): raise SystemExit('Required executable unavailable: '+executable)
    library=Library(os.environ.get('MUSIC_DATA_DIR','/var/lib/iwtxz-music'),os.environ['MUSIC_PUBLIC_ORIGIN'],os.environ['SUPABASE_URL'],os.environ['SUPABASE_PUBLISHABLE_KEY'])
    origins=set(os.environ.get('MUSIC_ALLOWED_ORIGINS','https://iwtxz.su,https://www.iwtxz.su,https://iwtxz.ru,https://www.iwtxz.ru').split(','))
    server(library,origins,port=int(os.environ.get('PORT','8787'))).serve_forever()

import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from app import Library, ApiError, music_source, server

ALICE='967385a2-8f95-4499-97b1-8ff92d973cfe'
BOB='967385a2-8f95-4499-97b1-8ff92d973caa'
SUPABASE='https://fixture.supabase.co'

class MusicTests(unittest.TestCase):
    def test_source_allowlist(self):
        for url in ('https://youtu.be/example','https://www.youtube.com/watch?v=example','https://soundcloud.com/artist/song','https://artist.bandcamp.com/track/name'):
            self.assertEqual(music_source(url),url)
        for url in ('http://youtube.com/watch?v=x','https://youtube.com.evil.example/x','https://youtube.com@127.0.0.1/x','https://127.0.0.1/x','https://soundcloud.com:1234/x','https://youtube.com/','https://example.com/audio.mp3','file:///etc/passwd'):
            with self.assertRaises(ApiError): music_source(url)

    def test_jobs_library_isolation_and_public_seek(self):
        with tempfile.TemporaryDirectory(prefix='iwtxz-music-test-') as directory:
            def download(source,path):
                if 'unavailable' in source: raise ApiError(422,'Недоступный трек')
                audio=path/'track.mp3'; audio.write_bytes(b'ID3'+bytes(range(256))*20)
                return {'title':'Test music','duration':42},audio
            lib=Library(directory,'https://music.example',SUPABASE,'public',downloader=download,minimum_free=0)
            def verify(token):
                if token not in ('alice-token','bob-token'):raise ApiError(401,'Войти')
                return ALICE if token=='alice-token' else BOB
            lib.verify=verify
            api=server(lib,{'https://iwtxz.ru'},port=0)
            thread=threading.Thread(target=api.serve_forever,daemon=True); thread.start()
            origin=f'http://127.0.0.1:{api.server_port}'
            def request(path,token=None,data=None,headers=None):
                selected={'Origin':'https://iwtxz.ru',**(headers or {})}
                if token:selected['Authorization']='Bearer '+token
                if data is not None:selected['Content-Type']='application/json'
                return urlopen(Request(origin+path,headers=selected,data=json.dumps(data).encode() if data is not None else None),timeout=5)
            try:
                with self.assertRaises(HTTPError) as error:request('/v1/library')
                self.assertEqual(error.exception.code,401)
                with self.assertRaises(HTTPError) as error:request('/v1/library','alice-token',headers={'Origin':'https://evil.example'})
                self.assertEqual(error.exception.code,403)
                with request('/v1/import','alice-token',{'url':'https://soundcloud.com/artist/song'}) as response:self.assertEqual(response.status,202)
                for _ in range(100):
                    tracks=lib.list(ALICE)['tracks']
                    if tracks:break
                    time.sleep(.02)
                self.assertEqual(len(tracks),1)
                self.assertEqual(tracks[0]['title'],'Test music')
                self.assertEqual(tracks[0]['url'],'https://music.example/media/'+tracks[0]['id']+'.mp3')
                with request('/v1/library','bob-token') as response:self.assertEqual(json.load(response)['tracks'],[])
                with request('/media/'+tracks[0]['id']+'.mp3',headers={'Range':'bytes=2-11'}) as response:
                    self.assertEqual(response.status,206);self.assertEqual(len(response.read()),10)
                    self.assertEqual(response.headers['Access-Control-Allow-Origin'],'*')
                with self.assertRaises(HTTPError) as error:request('/v1/remove','bob-token',{'id':tracks[0]['id']})
                self.assertEqual(error.exception.code,404)
                with request('/v1/remove','alice-token',{'id':tracks[0]['id']}) as response:self.assertEqual(response.status,200)
                self.assertEqual(lib.list(ALICE)['tracks'],[])
                with request('/media/'+tracks[0]['id']+'.mp3') as response:self.assertGreater(len(response.read()),0)
                lib.enqueue(ALICE,'https://soundcloud.com/artist/unavailable')
                for _ in range(100):
                    jobs=lib.list(ALICE)['jobs']
                    if jobs and jobs[0]['state']=='error':break
                    time.sleep(.02)
                self.assertEqual(jobs[0]['error'],'Недоступный трек')
                with self.assertRaises(ApiError):lib.remember(ALICE,{'url':SUPABASE+'/storage/v1/object/public/profile-assets/'+BOB+'/music.mp3'})
                with self.assertRaises(ApiError):lib.remember(ALICE,{'url':SUPABASE+'/storage/v1/object/public/profile-assets/'+ALICE+'/%2e%2e/music.mp3'})
                lib.remember(ALICE,{'url':SUPABASE+'/storage/v1/object/public/profile-assets/'+ALICE+'/music.mp3','title':'Upload'})
                self.assertEqual(lib.list(ALICE)['tracks'][0]['title'],'Upload')
                upload=lib.list(ALICE)['tracks'][0]
                lib.remove(ALICE,upload['id'])
                lib.remember(ALICE,{'url':upload['url'],'title':'Upload'})
                self.assertEqual(lib.list(ALICE)['tracks'][0]['id'],upload['id'])
            finally:
                api.shutdown();api.server_close();thread.join();lib.pool.shutdown(wait=True)

if __name__=='__main__':unittest.main()

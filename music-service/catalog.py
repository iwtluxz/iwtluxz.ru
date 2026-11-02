"""Public music metadata search. No audio or credentials in catalog responses."""
import base64
import json
import os
import re
import subprocess
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

class CatalogError(Exception): pass

class Catalog:
    def __init__(self):
        self.cache={};self.lock=threading.Lock();self.token=None
        self.slots=threading.BoundedSemaphore(2)
    def json(self,url,headers=None,data=None):
        with urlopen(Request(url,headers={'User-Agent':'iwtxz-music-catalog/1.0',**(headers or {})},data=data),timeout=12) as response:
            payload=response.read(2_000_001)
            if len(payload)>2_000_000:raise CatalogError('Ответ музыкального сервиса слишком большой.')
            return json.loads(payload)
    def search(self,service,query):
        if service not in ('yandex','youtube','spotify'):raise CatalogError('Выбери музыкальный сервис.')
        query=' '.join(query.split())
        if not 2<=len(query)<=100:raise CatalogError('Введи от 2 до 100 символов.')
        key=(service,query.casefold())
        with self.lock:
            cached=self.cache.get(key)
            if cached and cached[0]>time.time():return cached[1]
        if not self.slots.acquire(blocking=False):raise CatalogError('Поиск занят. Попробуй через несколько секунд.')
        try:
            tracks=getattr(self,'search_'+service)(query)
            result={'tracks':tracks,'service':service,'query':query}
            with self.lock:
                self.cache={k:v for k,v in self.cache.items() if v[0]>time.time()}
                if len(self.cache)>=200:self.cache.pop(next(iter(self.cache)))
                self.cache[key]=(time.time()+600,result)
            return result
        except CatalogError:raise
        except Exception as error:raise CatalogError('Сервис поиска сейчас не отвечает. Попробуй ещё раз или вставь ссылку на трек.') from error
        finally:self.slots.release()
    def search_yandex(self,query):
        result=self.json('https://api.music.yandex.net/search?'+urlencode({'text':query,'type':'track','page':0}))
        tracks=[]
        for item in (result.get('result',{}).get('tracks',{}).get('results',[]) or [])[:12]:
            albums=item.get('albums',[])
            if not item.get('available') or not albums:continue
            track_id=str(item.get('id',''));album_id=str(albums[0].get('id',''))
            if not track_id.isdigit() or not album_id.isdigit():continue
            cover=item.get('coverUri','')
            tracks.append({'id':'yandex-'+track_id,'service':'yandex','title':str(item.get('title',''))[:120],
                'artist':', '.join(str(a.get('name','')) for a in item.get('artists',[]))[:160],
                'url':f'https://music.yandex.ru/album/{album_id}/track/{track_id}',
                'cover':'https://'+cover.replace('%%','200x200') if re.match(r'^avatars\.(?:yandex\.net|mds\.yandex\.net)/',cover) else '',
                'duration':round(item.get('durationMs',0)/1000)})
        return tracks
    def search_youtube(self,query):
        key=os.environ.get('YOUTUBE_API_KEY','')
        if key:
            payload=self.json('https://www.googleapis.com/youtube/v3/search?'+urlencode({'part':'snippet','type':'video','videoEmbeddable':'true','maxResults':12,'q':query,'key':key}))
            return [{'id':'youtube-'+item['id']['videoId'],'service':'youtube','title':item['snippet']['title'][:120],
                'artist':item['snippet']['channelTitle'][:160],'url':'https://www.youtube.com/watch?v='+item['id']['videoId'],
                'cover':item['snippet'].get('thumbnails',{}).get('medium',{}).get('url','')} for item in payload.get('items',[])]
        command=[os.environ.get('YTDLP_BIN','yt-dlp'),'--ignore-config','--force-ipv4','--flat-playlist','--dump-single-json','--skip-download','--no-warnings','--socket-timeout','5','--retries','0','--extractor-retries','0','--playlist-end','12','--','ytsearch12:'+query]
        result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25,check=True)
        payload=json.loads(result.stdout)
        tracks=[]
        for item in payload.get('entries',[])[:12]:
            video_id=item.get('id','')
            if not re.fullmatch(r'[\w-]{11}',video_id):continue
            tracks.append({'id':'youtube-'+video_id,'service':'youtube','title':str(item.get('title',''))[:120],
                'artist':str(item.get('channel') or item.get('uploader') or 'YouTube')[:160],
                'url':'https://www.youtube.com/watch?v='+video_id,'cover':f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg','duration':item.get('duration')})
        return tracks
    def search_spotify(self,query):
        client_id=os.environ.get('SPOTIFY_CLIENT_ID','');secret=os.environ.get('SPOTIFY_CLIENT_SECRET','')
        if not client_id or not secret:raise CatalogError('Поиск Spotify ещё не подключён. Пока можно выбрать трек из подборки или вставить ссылку Spotify.')
        if not self.token or self.token[0]<time.time():
            auth=base64.b64encode((client_id+':'+secret).encode()).decode()
            data=self.json('https://accounts.spotify.com/api/token',{'Authorization':'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},b'grant_type=client_credentials')
            self.token=(time.time()+min(int(data['expires_in']),3500),data['access_token'])
        data=self.json('https://api.spotify.com/v1/search?'+urlencode({'q':query,'type':'track','limit':10}),{'Authorization':'Bearer '+self.token[1]})
        return [{'id':'spotify-'+item['id'],'service':'spotify','title':item['name'][:120],
            'artist':', '.join(a['name'] for a in item['artists'])[:160],
            'url':'https://open.spotify.com/track/'+item['id'],
            'cover':next(iter(item.get('album',{}).get('images',[])),{}).get('url',''),
            'duration':round(item.get('duration_ms',0)/1000)} for item in data.get('tracks',{}).get('items',[])]

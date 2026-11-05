import unittest
import http.client
import socket
import ssl
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from catalog import Catalog,CatalogError,connect_ipv4,IPv4HTTPSConnection,IPv4HTTPSHandler

class CatalogTests(unittest.TestCase):
    def test_ytdlp_search_fallback_does_not_force_a_global_address_family(self):
        def run(command,**options):
            self.assertFalse(set(command)&{'-4','-6','--force-ipv4','--force-ipv6'})
            self.assertIn('--skip-download',command)
            self.assertEqual(options['timeout'],25)
            return SimpleNamespace(stdout=b'{"entries":[{"id":"abcdefghijk","title":"Audio","channel":"Artist"}]}')
        with patch.dict('os.environ',{'YOUTUBE_API_KEY':''}),patch('catalog.subprocess.run',side_effect=run):
            tracks=Catalog().search_youtube('Artist Audio')
        self.assertEqual(tracks[0]['url'],'https://www.youtube.com/watch?v=abcdefghijk')

    def test_ipv4_transport_resolves_only_ipv4_and_retries_numeric_addresses(self):
        endpoints=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('192.0.2.1',443)),(socket.AF_INET,socket.SOCK_STREAM,6,'',('192.0.2.2',443))]
        connected=object()
        with patch('catalog.socket.getaddrinfo',return_value=endpoints) as resolve, patch('catalog.socket.create_connection',side_effect=[OSError('First address unavailable'),connected]) as connect:
            self.assertIs(connect_ipv4(('www.googleapis.com',443),12),connected)
            resolve.assert_called_once_with('www.googleapis.com',443,socket.AF_INET,socket.SOCK_STREAM)
            self.assertEqual([args.args[0] for args in connect.call_args_list],[('192.0.2.1',443),('192.0.2.2',443)])
            self.assertTrue(all(0<args.args[1]<=12 for args in connect.call_args_list))

    def test_ipv4_connection_preserves_tls_hostname_and_socket_globals(self):
        original_resolve=socket.getaddrinfo
        original_connect=socket.create_connection
        context=MagicMock()
        connection=IPv4HTTPSConnection('www.googleapis.com',context=context)
        self.assertIs(connection._create_connection,connect_ipv4)
        self.assertIs(socket.getaddrinfo,original_resolve)
        self.assertIs(socket.create_connection,original_connect)
        verified=IPv4HTTPSConnection('www.googleapis.com')
        self.assertTrue(verified._context.check_hostname)
        self.assertEqual(verified._context.verify_mode,ssl.CERT_REQUIRED)
        raw_socket=object();connection.sock=raw_socket
        with patch.object(http.client.HTTPConnection,'connect'):
            connection.connect()
        context.wrap_socket.assert_called_once_with(raw_socket,server_hostname='www.googleapis.com')

    def test_only_official_youtube_search_selects_ipv4_transport(self):
        catalog=Catalog()
        with patch.dict('os.environ',{'YOUTUBE_API_KEY':'test-only-key'}), patch.object(catalog,'json',return_value={'items':[]}) as fetch:
            self.assertEqual(catalog.search_youtube('A track'),[])
            self.assertEqual(fetch.call_args.kwargs,{'ipv4':True})
        payload=MagicMock()
        payload.__enter__.return_value.read.return_value=b'{}'
        opener=MagicMock();opener.open.return_value=payload
        with patch('catalog.build_opener',return_value=opener) as build,patch('catalog.urlopen',return_value=payload) as normal:
            catalog.json('https://www.googleapis.com/youtube/v3/search',ipv4=True)
            self.assertIsInstance(build.call_args.args[0],IPv4HTTPSHandler)
            normal.assert_not_called()
            catalog.json('https://api.music.yandex.net/search')
            normal.assert_called_once()
            self.assertEqual(build.call_count,1)

    def test_yandex_search_sanitizes_rows_and_caches_metadata(self):
        catalog=Catalog()
        response={'result':{'tracks':{'results':[
            {'id':123,'title':'A track','artists':[{'name':'An artist'}],'available':True,'albums':[{'id':456}],'coverUri':'avatars.yandex.net/get-music-content/cover/%%','durationMs':123000},
            {'id':'../bad','available':True,'albums':[{'id':456}]},
            {'id':777,'available':False,'albums':[{'id':456}]}]}}}
        with patch.object(catalog,'json',return_value=response) as fetch:
            data=catalog.search('yandex','a track')
            self.assertEqual(len(data['tracks']),1)
            self.assertEqual(data['tracks'][0]['url'],'https://music.yandex.ru/album/456/track/123')
            self.assertEqual(catalog.search('yandex','A TRACK'),data)
            self.assertEqual(fetch.call_count,1)
    def test_invalid_inputs_and_missing_spotify_configuration_are_explicit(self):
        catalog=Catalog()
        for service,query in [('unknown','a track'),('youtube','x'),('yandex','x'*101)]:
            with self.assertRaises(CatalogError):catalog.search(service,query)
        with patch.dict('os.environ',{'SPOTIFY_CLIENT_ID':'','SPOTIFY_CLIENT_SECRET':''}):
            with self.assertRaisesRegex(CatalogError,'Spotify'):catalog.search('spotify','a track')
    def test_failed_provider_does_not_leave_search_slot_locked(self):
        catalog=Catalog()
        with patch.object(catalog,'search_yandex',side_effect=TimeoutError):
            for _ in range(3):
                with self.assertRaisesRegex(CatalogError,'сейчас не отвечает'):catalog.search('yandex','a track')

if __name__=='__main__':unittest.main()

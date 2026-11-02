import unittest
from unittest.mock import patch
from catalog import Catalog,CatalogError

class CatalogTests(unittest.TestCase):
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

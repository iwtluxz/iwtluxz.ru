"""Extract small, still catalogue previews; keep original Discord animations intact."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / 'img' / 'avatar-decorations'
for source in root.glob('*.png'):
    with Image.open(source) as image:
        image.seek(min(5, getattr(image, 'n_frames', 1) - 1))
        frame = image.convert('RGBA')
        frame.thumbnail((112, 112), Image.Resampling.LANCZOS)
        frame.save(source.with_suffix('.webp'), 'WEBP', quality=85, method=6)
        print(source.with_suffix('.webp').name)

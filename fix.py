from pathlib import Path
p=Path('app/page.tsx');s=p.read_text(encoding='utf-8');s=s.replace('setError((e as Error).message)}}>', 'setError((e as Error).message)}}}>');p.write_text(s,encoding='utf-8')

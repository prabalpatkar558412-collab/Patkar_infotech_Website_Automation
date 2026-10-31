from pathlib import Path
p=Path('app/api/records/route.ts');s=p.read_text();s=s.replace('const data=schemas[kind].parse(body.data);','const data=schemas[kind].parse(body.data) as Record<string,any>;');p.write_text(s)

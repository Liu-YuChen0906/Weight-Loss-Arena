import hashlib
import json
import sqlite3

db = sqlite3.connect('file:/var/lib/payathon-test/test.sqlite?mode=ro', uri=True)
data = {table: db.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall()
        for table in ('users', 'rooms', 'members', 'records')}
print(json.dumps({**{table: len(rows) for table, rows in data.items()},
                  'digest': hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()}))
db.close()

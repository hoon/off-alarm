## DuckDB to SQLite migration

Run `off-alarm` first to create the SQLite database then stop it.

DuckDB doesn't like it when the attached SQLite database name is the same as the DuckDB database it has open.

```bash
ln -s button_event.sqlite button_event_new.sqlite
```

In DuckDB:

```bash
duckdb button_event.duckdb
```

```sql
INSTALL sqlite;
LOAD sqlite;
ATTACH 'button_event_new.sqlite' (TYPE sqlite);
USE button_event_new;

INSERT INTO button_event_new.button_event (etime, event_type, temp_c, illuminance_lux) SELECT epoch_ms(b1.etime) AS etime, event_type, temp_c, illuminance_lux FROM button_event.button_event AS b1;
```

Remove the symlink.

```bash
rm button_event_new.sqlite
```

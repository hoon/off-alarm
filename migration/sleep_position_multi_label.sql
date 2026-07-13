-- sqlite3 sensor.sqlite ".read src/sql/sleep_position_multi_label.sql"
INSERT INTO sleep_position
    SELECT
        stime_sec,
        prediction AS position,
        confidence AS position_confidence, 
        NULL AS sleep_status,
        NULL AS sleep_status_confidence,
        NULL AS mask_status,
        NULL AS mask_status_confidence 
    FROM sleep_position_old
;
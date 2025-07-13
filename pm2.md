## PM2 bug workaround
PM2 doesn't support bun properly. Use the following workaround suggested by @ofmendez on a related GitHub [issue](https://github.com/oven-sh/bun/issues/4949#issuecomment-2734875435):

Pretend node is bun (may be optional).
```bash
cd ~/.local/bin
ln -s `which bun` node
```

Start the app with PM2.
```bash
cd %OFF_ALARM_DIR%
pm2 start "bun src/index.ts" --name "off-alarm" --exp-backoff-restart-delay 10000
```

Save the PM2 process list.
```bash
pm2 save
```

Check the status of the process. Note the PID of the off-alarm process.
```bash
pm2 status
```

Check the process is indeed being run in bun.
```bash
ps -p $PID_OFF_ALARM -o args=
```
# Cloudflare無料公開の運用手順

1.4.0から運営者入口は `/platform` です。加盟店の追加、専用URLの自動発行、手動請求と入金記録は [PLATFORM.md](PLATFORM.md) を参照してください。加盟店のURLは `/s/<加盟店ID>/admin`、`/employee`、`/clock` となります。既存のルート `/admin` 等は従来の単一店舗用として残します。

公開URLは **https://shift-note.yuki-nova.workers.dev** です。管理者は `/admin`、従業員は `/employee` を開きます。Cloudflare Worker → Workers VPC Service → 名前付きTunnel → このWindows PCのアプリ、の順につながります。独自ドメインは不要です。WorkerとVPC Serviceは現在Cloudflareの無料枠・オープンベータで利用しています。ベータ終了後の料金・仕様は変わり得ます。

アプリ本体、OR-Tools、SQLiteはこのPCで実行します。**PCを停止・スリープすると公開URLも利用できません。** Cloudflareだけで24時間稼働するサーバーを無料で確保した構成ではありません。公開DBは `%LOCALAPPDATA%\ShiftNote\cloudflare-preview\shift.db` にあり、作業フォルダー直下の `shift.db` とは別です。

## このPCで再起動する

PowerShellを2つ開きます。1つ目で名前付きTunnelを起動します。トークンファイルはこのPCだけに保存され、共有しません。

```powershell
cd 'C:\Users\micro\product\バイトのシフト'
.\tools\cloudflared-windows-amd64.exe tunnel --no-autoupdate run --token-file "$env:LOCALAPPDATA\ShiftNote\cloudflare-preview\tunnel-token.txt"
```

2つ目でアプリを起動します。

```powershell
cd 'C:\Users\micro\product\バイトのシフト'
powershell -ExecutionPolicy Bypass -File scripts/start-cloudflare-preview.ps1 -PublicOrigin https://shift-note.yuki-nova.workers.dev
```

初回の管理者設定キーは `%LOCALAPPDATA%\ShiftNote\cloudflare-preview\setup-token.txt` にあります。本人が管理者画面で10文字以上のパスワードを設定してください。キー・パスワード・トンネルトークンを従業員に渡さないでください。アプリの再起動後も認証用秘密値は同じPC内に保存されます。2つのターミナルを閉じると接続が止まります。

## 従業員へ配布する前に

1. 管理者画面の「スタッフ」で本人のメールアドレスを登録します。
2. [Gmail送信設定](../frontend/public/help/email.html)を完了し、従業員ログイン画面の「確認コードを送る」が使える状態にします。
3. 本人の受信箱でコードを受け取り、希望提出・確定シフト表示まで確認します。
4. 従業員へ `https://shift-note.yuki-nova.workers.dev/employee` だけを伝えます。管理者の初回設定キーは伝えません。

Gmailが未設定でも両画面を開けますが、従業員はメール認証できません。現在の公開DBは既存店舗データを含まない別DBです。必要な店舗・スタッフ・条件を管理者画面で登録してください。

## 勤怠画面を店舗で使う

管理者画面の「勤怠・変更申請」で端末登録リンクを作り、店舗の共用端末で一度だけ開いてください。登録後は固定URL `/clock` を開くだけで使え、毎日リンクを張り替える必要はありません。ブラウザーのCookieを削除した場合や別端末を使う場合は再登録が必要です。出勤時は本日の確定勤務から名前を選び、退勤時は「現在出勤中」から選びます。登録リンクは端末を1台登録すると無効になりますが、登録済み端末は影響を受けません。不要になった端末は管理画面で利用停止できます。名前だけで打刻できるため、店舗内の端末で扱ってください。休憩は自動で差し引かず、管理者が実際の休憩と打刻漏れを確認・修正します。従業員は本人の「勤務実績・給与」で結果を確認できます。

変更相談は従業員の「勤務日・変更相談」から送信します。管理者の回答だけでは確定シフトは変更されません。必要ならシフト案を再編集・再確定してください。人件費は契約時給・登録交通費に基づく概算です。税・保険・割増賃金・控除を含む正式な給与計算は別途行ってください。

## 更新・バックアップ

Workerの中継コードは `cloudflare-worker/` にあります。更新時は同フォルダーで `npx wrangler deploy` を実行します。VPC Service IDと名前付きTunnelは既にこのCloudflareアカウントに作成済みです。データのバックアップにはアプリを停止してから公開DBのコピーを別の保管先へ置き、復元操作も確認してください。OS再起動後は上の2つのプロセスを再起動します。公開前・更新後は `/healthz` と両画面、未ログイン管理APIの拒否、本人メールの受信を確認します。

無料枠とベータの最新条件は [Workers VPC料金](https://developers.cloudflare.com/workers-vpc/platform/pricing/) と [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/) で確認してください。Cloudflare側の固定URLは維持できますが、このPC・ネット回線の稼働率は保証されません。

## 一時トンネルへ戻す場合

名前付きTunnelやWorkerに障害があるときだけ、`cloudflared tunnel --url http://127.0.0.1:8002` で一時URLを発行できます。その場合はアプリの `-PublicOrigin` を一時URLに合わせて再起動してください。URLは毎回変わるため、従業員への常用配布には使いません。

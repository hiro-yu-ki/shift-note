# Cloudflareで無料の一時公開

現在のPython・OR-Tools・SQLiteを維持する無料の試用方法です。アプリはこのWindows PCで動き、Cloudflare Quick Tunnelが一時的なHTTPS URLを発行します。既存の `shift.db` は公開せず、 `%LOCALAPPDATA%\ShiftNote\cloudflare-preview\shift.db` に別の空DBを作成します。

**Quick Tunnelは試用・開発向けです。** URLはトンネルを起動し直すたびに変わり、Cloudflareは稼働時間を保証していません。PC、アプリ、cloudflaredの3つが動いている間だけアクセスできます。固定URLで継続利用する場合はCloudflareで管理する独自ドメインを用意し、名前付きTunnelへ切り替えます。ドメインをまだ持っていない場合、その取得費用はこの無料構成に含まれません。

## 起動方法

1. [Cloudflare公式のWindows版cloudflared](https://developers.cloudflare.com/tunnel/downloads/)を取得します。このPCでは次のスクリプトが公式リリースから取得し、SHA256を照合します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/get-cloudflared.ps1
```
2. PowerShellを開き、次を実行します。

```powershell
.\tools\cloudflared-windows-amd64.exe tunnel --no-autoupdate --url http://127.0.0.1:8002
```

3. 出力された `https://...trycloudflare.com` を控えます。別のPowerShellで次を実行します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-cloudflare-preview.ps1 -PublicOrigin https://発行されたURL.trycloudflare.com
```

4. `公開URL/admin` を開きます。初回設定キーはこのPCの `%LOCALAPPDATA%\ShiftNote\cloudflare-preview\setup-token.txt` に保存されます。本人がそのファイルを開き、10文字以上の管理者パスワードを設定してください。キーやパスワードを従業員へ渡さないでください。
5. 管理者画面にログイン後、店舗・スタッフ・勤務条件を登録します。従業員には `公開URL/employee` を伝えます。

トンネルのURLが変わったら、新しいURLを使って手順3のアプリも再起動します。既存の試用DBは残りますが、セッションは再ログインが必要です。公開URLの変更前に従業員へ古いURLを配布しないでください。

## メール認証

公開画面を開くことにGmailは不要です。従業員が自分のメールでログインする前には、送信元の設定と実際の受信確認が必要です。このPCで [Gmailの設定手順](../frontend/public/help/email.html) に従い `scripts/configure-gmail.ps1` を実行します。設定はWindowsユーザー単位で暗号化され、試用サーバーは自動で読み取ります。受信先は管理画面で本人に登録します。認証コードの実送信は、送信元の設定が終わるまで利用できません。

## 継続利用へ切り替える条件

- 固定URLにはCloudflare管理下の独自ドメインと、名前付きTunnelが必要です。[CloudflareのTunnel設定](https://developers.cloudflare.com/tunnel/get-started/)に従います。無料プランでTunnelを利用できても、新しく取得するドメイン自体は無料とは限りません。
- このPCは常時起動し、DBバックアップを別の保管先に定期的に置く必要があります。Quick Tunnelは本番運用の可用性を保証しません。
- Cloudflare Workers無料枠だけに現在のシフト計算を移す方法は採用していません。現在の求解処理は無料枠の実行時間内に収まりません。

公開前には、初回パスワード、本人メールの受信、希望提出、案の作成、確定表示、バックアップと復元を実データに近い条件で確認してください。

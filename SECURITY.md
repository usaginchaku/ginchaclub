# 公開とセキュリティ

## 構成

- GitHub Pagesの静的配信。ローカル開発用の `server.mjs` は公開サーバーとして実行しません。
- ユーザー登録、入力フォーム、ファイルアップロード、録音、データベース、外部API、解析タグはありません。
- 曲・スクリプト・画像は同じ公開先から読み込みます。音と演奏パターンはブラウザー内で処理し、パターンをサーバーへ送信しません。
- ホスティング事業者の通常のアクセスログは、このアプリの収集機能とは別です。

## 対策

- HTTPSを強制し、HTMLのCSPで同一オリジンの必要なリソースのみ許可。外部スクリプト、インラインスクリプト、eval、フォーム送信、埋め込みオブジェクトを許可しません。
- Referrer-Policyは `no-referrer`。外部リンクは `rel="noreferrer"` で開きます。
- 公開対象は `tools/public-files.mjs` の明示リストのみ。開発ファイル、スクリーンショット、参考画像、秘密情報を配信物に含めません。
- 実行時の外部依存パッケージなし。GitHub Actionsは公式アクションのコミットSHAに固定し、テスト成功後だけ配信します。
- ビルドは読み取り権限のみ。公開ジョブだけにPages更新と短期OIDC認証を許可し、長期トークンは保存しません。
- フォークからのプルリクエストでは公開ジョブを動かしません。

## 限界と運用

安全性を完全に保証するものではありません。GitHubアカウントや端末が侵害されるとサイトの書き換えにつながります。GitHubアカウントのパスキー／二要素認証と復旧手段は所有者が管理してください。

GitHub Pagesではアプリ独自のHTTPレスポンスヘッダーを設定していません。CSPはHTMLのmetaで適用しており、HTTPヘッダー限定の `frame-ancestors` による他サイトからのフレーム埋め込み禁止は保証しません。個人情報・決済・管理操作を扱う機能を追加する場合は、ホスティングと認証設計を再評価してください。

公開後はHTTPS、読み込まれたファイルのSHA-256、曲の取得、主要操作、ブラウザーのCSP違反・エラーを確認します。表示や再生が壊れた場合は原因コミットをrevertし、mainの公開ワークフローを再実行して前の正常版に戻します。秘密情報が漏れた場合は単なる削除で済ませず、先に該当する認証情報を失効させます。

参考： [GitHub PagesのHTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)、[CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)。

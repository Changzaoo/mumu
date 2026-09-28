# Publicar o APK Android

O app abre `https://radinho.online` (ver `apps/web/capacitor.config.ts`): **tudo o
que vai para o site chega ao app sozinho**. Só mudanças NATIVAS (MainActivity,
`capacitor.config.ts`, plugins, ícones) pedem um APK novo.

## Passo a passo (num computador com Android SDK e Java 21)

Use o MESMO número em tudo: ele só pode crescer.

```bash
export VERSION_CODE=4 VERSION_NAME=1.0.4          # o próximo número
export ANDROID_KEYSTORE_PATH=~/chaves/radinho.jks # a chave de sempre — nunca outra
export ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=radinho ANDROID_KEY_PASSWORD=…

pnpm install
pnpm --filter @radinho/shared build
pnpm --filter @radinho/web android:build   # build web + cap sync (lê VERSION_CODE)
cd apps/web/android && ./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../public/radinho.apk
```

Depois, em `apps/web/public/radinho-apk.json`:

```json
{ "versionCode": 4, "versionName": "1.0.4" }
```

Commit + deploy do site. Quem tem o app com versão menor recebe o aviso
"Nova versão do app" com o botão **Baixar** (o download sai pelo navegador do
sistema e o Android instala por cima, sem perder nada).

## Por que o número importa

- `VERSION_CODE` precisa ser o mesmo no `cap sync` (vai no user-agent do app como
  `RadinhoApp/N`) e no Gradle (versão que o Android compara ao instalar).
- Assinatura com outra chave = o Android recusa instalar por cima.

## Quem instalou o APK antigo (1.0.2)

Aquele APK trazia o site empacotado e não se atualiza nem avisa. Essas pessoas
precisam baixar `radinho.online/radinho.apk` uma vez; a partir daí os avisos
funcionam sozinhos.

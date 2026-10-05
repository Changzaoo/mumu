package online.radinho.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * O APP SE ATUALIZA SOZINHO.
 *
 * App de fora da loja não tem quem o atualize: a pessoa via o aviso, baixava o
 * APK pelo navegador, achava o arquivo e instalava — e quase ninguém faz isso.
 * Aqui o próprio app baixa o APK novo e o entrega ao instalador do sistema.
 *
 * No Android 12 ou mais novo, um app que atualiza A SI MESMO pode pedir a
 * instalação SEM a tela de confirmação (`USER_ACTION_NOT_REQUIRED`), desde que
 * a pessoa tenha liberado uma vez "instalar apps desconhecidos" para ele. Em
 * Android mais antigo o sistema ainda mostra a confirmação — um toque.
 *
 * A instalação FECHA o app (o Android mata o processo para trocar o código).
 * Por isso o site só chama `instalar()` com o app em segundo plano e sem
 * música, ou quando a pessoa toca em "Atualizar".
 *
 * `window.Capacitor.Plugins.Atualizador`:
 *   estado()          → { podeInstalar, baixado, instalada, semToque }
 *   pedirPermissao()  → abre a tela de "instalar apps desconhecidos" deste app
 *   baixar({ url })   → { versao }  (só aceita o APK do radinho.online)
 *   instalar()        → entrega o APK baixado ao instalador
 */
@CapacitorPlugin(name = "Atualizador")
public class AtualizadorPlugin extends Plugin {

    private static final String ORIGEM = "https://radinho.online/";
    private static final String ARQUIVO = "atualizacao.apk";

    private final ExecutorService fila = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        // Sobra de uma atualização já instalada: não é mais novidade.
        if (versaoBaixada() <= versaoInstalada()) arquivo().delete();
    }

    private File arquivo() {
        return new File(getContext().getCacheDir(), ARQUIVO);
    }

    private boolean podeInstalar() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private int versaoInstalada() {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return (int) PackageInfoCompat.getLongVersionCode(info);
        } catch (PackageManager.NameNotFoundException impossivel) {
            return 0;
        }
    }

    /** versionCode do APK baixado — 0 se não há, se está corrompido ou se é de outro app. */
    private int versaoBaixada() {
        File apk = arquivo();
        if (!apk.exists()) return 0;
        PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (info == null || !getContext().getPackageName().equals(info.packageName)) return 0;
        return (int) PackageInfoCompat.getLongVersionCode(info);
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject saida = new JSObject();
        saida.put("podeInstalar", podeInstalar());
        saida.put("baixado", versaoBaixada());
        saida.put("instalada", versaoInstalada());
        saida.put("semToque", Build.VERSION.SDK_INT >= 31);
        call.resolve(saida);
    }

    @PluginMethod
    public void pedirPermissao(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent tela = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(tela);
            } catch (Exception semTela) {
                call.reject("Não deu para abrir os ajustes do Android.", "sem-ajustes");
                return;
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void baixar(PluginCall call) {
        String url = call.getString("url");
        // Só o APK do próprio site: o instalador ainda exige a MESMA assinatura,
        // mas não há por que buscar um instalável em outro lugar.
        if (url == null || !url.startsWith(ORIGEM)) {
            call.reject("Endereço de atualização inválido.", "endereco");
            return;
        }
        fila.execute(() -> {
            File destino = arquivo();
            File parcial = new File(getContext().getCacheDir(), ARQUIVO + ".parcial");
            HttpURLConnection conexao = null;
            try {
                conexao = (HttpURLConnection) new URL(url).openConnection();
                conexao.setConnectTimeout(15_000);
                conexao.setReadTimeout(30_000);
                if (conexao.getResponseCode() != 200) {
                    throw new IOException("HTTP " + conexao.getResponseCode());
                }
                try (InputStream entrada = conexao.getInputStream();
                     OutputStream saida = new FileOutputStream(parcial)) {
                    copiar(entrada, saida);
                }
                destino.delete();
                if (!parcial.renameTo(destino)) throw new IOException("não gravou o arquivo");
                int versao = versaoBaixada();
                if (versao <= versaoInstalada()) {
                    destino.delete();
                    call.reject("O arquivo baixado não é mais novo que o app.", "sem-novidade");
                    return;
                }
                JSObject resposta = new JSObject();
                resposta.put("versao", versao);
                call.resolve(resposta);
            } catch (Exception falha) {
                parcial.delete();
                call.reject(String.valueOf(falha.getMessage()), "download");
            } finally {
                if (conexao != null) conexao.disconnect();
            }
        });
    }

    @PluginMethod
    public void instalar(PluginCall call) {
        if (versaoBaixada() <= versaoInstalada()) {
            call.reject("Não há atualização baixada.", "nada-baixado");
            return;
        }
        if (!podeInstalar()) {
            call.reject("O Android ainda não deixa este app instalar atualizações.", "sem-permissao");
            return;
        }
        fila.execute(() -> {
            File apk = arquivo();
            try {
                PackageInstaller instalador = getContext().getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams pedido =
                    new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                pedido.setAppPackageName(getContext().getPackageName());
                if (Build.VERSION.SDK_INT >= 31) {
                    pedido.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                }
                int id = instalador.createSession(pedido);
                try (PackageInstaller.Session sessao = instalador.openSession(id)) {
                    try (InputStream entrada = new FileInputStream(apk);
                         OutputStream saida = sessao.openWrite("radinho", 0, apk.length())) {
                        copiar(entrada, saida);
                        sessao.fsync(saida);
                    }
                    int marcas = PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent aviso = PendingIntent.getBroadcast(
                        getContext(), id, new Intent(getContext(), AtualizacaoReceiver.class), marcas
                    );
                    sessao.commit(aviso.getIntentSender());
                }
                call.resolve();
            } catch (Exception falha) {
                call.reject(String.valueOf(falha.getMessage()), "instalacao");
            }
        });
    }

    private static void copiar(InputStream entrada, OutputStream saida) throws IOException {
        byte[] bloco = new byte[64 * 1024];
        int lidos;
        while ((lidos = entrada.read(bloco)) > 0) saida.write(bloco, 0, lidos);
    }
}

package online.radinho.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * O APP NÃO MORRE COM A TELA DESLIGADA — E MOSTRA O PLAYER DO SISTEMA.
 *
 * Sem um serviço em primeiro plano, o Android trata o radinho como um app
 * qualquer em segundo plano: com a tela apagada ele é congelado e, pouco
 * depois, morto para economizar bateria — a música para "do nada" (Motorola e
 * Samsung são os mais agressivos). Todo app de música roda exatamente isto: um
 * serviço do tipo "reprodução de mídia" com notificação fixa. Enquanto ele
 * existe, o sistema sabe que há som saindo e não mata o processo.
 *
 * A notificação é o PLAYER do Android (sessão de mídia): capa, título, artista,
 * anterior · tocar/pausar · próxima e a barra de progresso — na barra de
 * status, na tela de bloqueio, no relógio e nos botões do fone. O WebView não
 * publica a Media Session do site como o Chrome faz, então quem publica é este
 * serviço; os toques voltam ao site pelo TocadorPlugin (evento "comando").
 *
 * Junto, duas travas enquanto toca: o processador acordado (wake lock parcial,
 * a tela pode apagar) e o Wi-Fi em alto desempenho (sem elas o stream engasga
 * quando o rádio do celular cochila).
 */
public class ServicoDeReproducao extends Service {

    static final String CANAL = "reproducao";
    static final int ID_NOTIFICACAO = 1;
    static final String EXTRA_TITULO = "titulo";
    static final String EXTRA_ARTISTA = "artista";
    static final String EXTRA_CAPA = "capa";
    static final String EXTRA_DURACAO = "duracaoMs";
    static final String EXTRA_POSICAO = "posicaoMs";
    static final String EXTRA_TOCANDO = "tocando";

    private static final String ACAO_ANTERIOR = "online.radinho.app.ANTERIOR";
    private static final String ACAO_ALTERNAR = "online.radinho.app.ALTERNAR";
    private static final String ACAO_PROXIMA = "online.radinho.app.PROXIMA";

    /** Quem leva os toques do player do sistema de volta ao site (TocadorPlugin). */
    interface OuvinteDeComando {
        void comando(String acao, long posicaoMs);
    }

    static volatile OuvinteDeComando ouvinte;
    /** O serviço vivo, se houver: atualizar por ele dispensa pedir um novo começo ao sistema. */
    static volatile ServicoDeReproducao instancia;

    private final ExecutorService rede = Executors.newSingleThreadExecutor();
    private final Handler principal = new Handler(Looper.getMainLooper());

    private MediaSessionCompat sessao;
    private PowerManager.WakeLock processador;
    private WifiManager.WifiLock wifi;

    private String titulo;
    private String artista;
    private String capaUrl;
    private Bitmap capa;
    private long duracaoMs;
    private long posicaoMs;
    private boolean tocando = true;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instancia = this;
        sessao = new MediaSessionCompat(this, "radinho");
        sessao.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                avisar("tocar", -1);
            }

            @Override
            public void onPause() {
                avisar("pausar", -1);
            }

            @Override
            public void onSkipToNext() {
                avisar("proxima", -1);
            }

            @Override
            public void onSkipToPrevious() {
                avisar("anterior", -1);
            }

            @Override
            public void onSeekTo(long posicao) {
                avisar("posicionar", posicao);
            }
        });
        sessao.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String acao = intent != null ? intent.getAction() : null;
        if (ACAO_ANTERIOR.equals(acao)) {
            avisar("anterior", -1);
        } else if (ACAO_PROXIMA.equals(acao)) {
            avisar("proxima", -1);
        } else if (ACAO_ALTERNAR.equals(acao)) {
            avisar(tocando ? "pausar" : "tocar", -1);
        } else if (intent != null) {
            guardar(intent);
        }
        publicar(true);
        segurarTravas();
        // Morto pelo sistema mesmo assim (memória no limite): volta sozinho.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        instancia = null;
        soltarTravas();
        if (sessao != null) {
            sessao.setActive(false);
            sessao.release();
        }
        rede.shutdownNow();
        super.onDestroy();
    }

    /** Faixa/estado novos vindos do site, com o serviço já vivo. */
    void atualizar(Intent dados) {
        guardar(dados);
        publicar(false);
    }

    private static void avisar(String acao, long posicaoMs) {
        OuvinteDeComando o = ouvinte;
        if (o != null) o.comando(acao, posicaoMs);
    }

    private void guardar(Intent dados) {
        titulo = dados.getStringExtra(EXTRA_TITULO);
        artista = dados.getStringExtra(EXTRA_ARTISTA);
        duracaoMs = dados.getLongExtra(EXTRA_DURACAO, 0);
        posicaoMs = dados.getLongExtra(EXTRA_POSICAO, 0);
        tocando = dados.getBooleanExtra(EXTRA_TOCANDO, true);
        String novaCapa = dados.getStringExtra(EXTRA_CAPA);
        boolean mudou = novaCapa == null ? capaUrl != null : !novaCapa.equals(capaUrl);
        if (mudou) {
            capaUrl = novaCapa;
            capa = null;
            if (novaCapa != null) buscarCapa(novaCapa);
        }
    }

    /** A capa vem da rede, fora da thread principal; chega depois e só vale se a faixa ainda é a mesma. */
    private void buscarCapa(final String url) {
        rede.execute(() -> {
            Bitmap imagem = null;
            HttpURLConnection conexao = null;
            try {
                conexao = (HttpURLConnection) new URL(url).openConnection();
                conexao.setConnectTimeout(8_000);
                conexao.setReadTimeout(8_000);
                try (InputStream entrada = conexao.getInputStream()) {
                    imagem = BitmapFactory.decodeStream(entrada);
                }
                // Capa enorme não cabe na notificação (limite do binder): reduz.
                if (imagem != null && Math.max(imagem.getWidth(), imagem.getHeight()) > 512) {
                    float fator = 512f / Math.max(imagem.getWidth(), imagem.getHeight());
                    imagem = Bitmap.createScaledBitmap(
                        imagem,
                        Math.round(imagem.getWidth() * fator),
                        Math.round(imagem.getHeight() * fator),
                        true
                    );
                }
            } catch (Exception semCapa) {
                imagem = null;
            } finally {
                if (conexao != null) conexao.disconnect();
            }
            final Bitmap pronta = imagem;
            principal.post(() -> {
                if (pronta == null || instancia != this || !url.equals(capaUrl)) return;
                capa = pronta;
                publicar(false);
            });
        });
    }

    /** Leva o estado atual à sessão de mídia e à notificação. */
    private void publicar(boolean emPrimeiroPlano) {
        if (sessao == null) return;
        MediaMetadataCompat.Builder dados = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, textoOu(titulo, "radinho"))
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, textoOu(artista, ""));
        if (duracaoMs > 0) dados.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duracaoMs);
        if (capa != null) dados.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, capa);
        sessao.setMetadata(dados.build());

        long acoes = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SEEK_TO;
        sessao.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(acoes)
                // Com a hora da leitura, o sistema anda a barra sozinho: o site só
                // precisa avisar em troca de faixa, pausa e salto.
                .setState(
                    tocando ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    posicaoMs,
                    tocando ? 1f : 0f,
                    SystemClock.elapsedRealtime()
                )
                .build()
        );

        Notification notificacao = notificacao();
        if (emPrimeiroPlano) {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(ID_NOTIFICACAO, notificacao, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(ID_NOTIFICACAO, notificacao);
            }
            return;
        }
        try {
            NotificationManagerCompat.from(this).notify(ID_NOTIFICACAO, notificacao);
        } catch (SecurityException semPermissao) {
            // sem permissão de notificação: a sessão de mídia segue valendo
        }
    }

    private static String textoOu(String texto, String padrao) {
        return texto != null && !texto.isEmpty() ? texto : padrao;
    }

    private PendingIntent botao(String acao, int codigo) {
        Intent toque = new Intent(this, ServicoDeReproducao.class).setAction(acao);
        return PendingIntent.getService(
            this, codigo, toque, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    /** O player na barra de status e na tela de bloqueio — tocar nele abre o app onde estava. */
    private Notification notificacao() {
        criarCanal(this);
        Intent abrir = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent aoTocar = PendingIntent.getActivity(
            this, 0, abrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        NotificationCompat.Builder montagem = new NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_stat_radinho)
            .setContentTitle(textoOu(titulo, "radinho"))
            .setContentText(textoOu(artista, tocando ? "Tocando" : "Pausado"))
            .setContentIntent(aoTocar)
            .setOngoing(tocando)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Anterior", botao(ACAO_ANTERIOR, 1))
            .addAction(
                tocando ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                tocando ? "Pausar" : "Tocar",
                botao(ACAO_ALTERNAR, 2)
            )
            .addAction(android.R.drawable.ic_media_next, "Próxima", botao(ACAO_PROXIMA, 3))
            .setStyle(
                new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(sessao.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );
        if (capa != null) montagem.setLargeIcon(capa);
        return montagem.build();
    }

    private static void criarCanal(Context contexto) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager gerente = contexto.getSystemService(NotificationManager.class);
        if (gerente == null || gerente.getNotificationChannel(CANAL) != null) return;
        NotificationChannel canal = new NotificationChannel(
            CANAL,
            "Música tocando",
            NotificationManager.IMPORTANCE_LOW
        );
        canal.setShowBadge(false);
        gerente.createNotificationChannel(canal);
    }

    private void segurarTravas() {
        if (processador == null) {
            PowerManager energia = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (energia != null) {
                processador = energia.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "radinho:reproducao");
                processador.setReferenceCounted(false);
            }
        }
        if (processador != null && !processador.isHeld()) processador.acquire();

        if (wifi == null) {
            WifiManager gerenteWifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (gerenteWifi != null) {
                wifi = gerenteWifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "radinho:stream");
                wifi.setReferenceCounted(false);
            }
        }
        if (wifi != null && !wifi.isHeld()) wifi.acquire();
    }

    private void soltarTravas() {
        if (processador != null && processador.isHeld()) processador.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
    }
}

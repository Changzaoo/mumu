package online.radinho.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * O APP NÃO MORRE COM A TELA DESLIGADA.
 *
 * Sem um serviço em primeiro plano, o Android trata o radinho como um app
 * qualquer em segundo plano: com a tela apagada ele é congelado e, pouco
 * depois, morto para economizar bateria — a música para "do nada" (Motorola e
 * Samsung são os mais agressivos). Todo app de música roda exatamente isto: um
 * serviço do tipo "reprodução de mídia" com notificação fixa. Enquanto ele
 * existe, o sistema sabe que há som saindo e não mata o processo.
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

    private PowerManager.WakeLock processador;
    private WifiManager.WifiLock wifi;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String titulo = intent != null ? intent.getStringExtra(EXTRA_TITULO) : null;
        String artista = intent != null ? intent.getStringExtra(EXTRA_ARTISTA) : null;
        Notification notificacao = notificacao(this, titulo, artista);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(ID_NOTIFICACAO, notificacao, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID_NOTIFICACAO, notificacao);
        }
        segurarTravas();
        // Morto pelo sistema mesmo assim (memória no limite): volta sozinho.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        soltarTravas();
        super.onDestroy();
    }

    /** A notificação fixa — tocar nela abre o app onde ele estava. */
    static Notification notificacao(Context contexto, String titulo, String artista) {
        criarCanal(contexto);
        Intent abrir = new Intent(contexto, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent aoTocar = PendingIntent.getActivity(
            contexto,
            0,
            abrir,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new NotificationCompat.Builder(contexto, CANAL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(titulo != null && !titulo.isEmpty() ? titulo : "radinho")
            .setContentText(artista != null && !artista.isEmpty() ? artista : "Tocando")
            .setContentIntent(aoTocar)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
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

package online.radinho.app;

import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A ponte do site para o serviço de reprodução (ver ServicoDeReproducao).
 * `window.Capacitor.Plugins.Tocador.manterVivo({ titulo, artista })` ao tocar;
 * `liberar()` depois de um tempo pausado.
 */
@CapacitorPlugin(name = "Tocador")
public class TocadorPlugin extends Plugin {

    @PluginMethod
    public void manterVivo(PluginCall call) {
        String titulo = call.getString("titulo");
        String artista = call.getString("artista");
        Intent servico = new Intent(getContext(), ServicoDeReproducao.class)
            .putExtra(ServicoDeReproducao.EXTRA_TITULO, titulo)
            .putExtra(ServicoDeReproducao.EXTRA_ARTISTA, artista);
        try {
            ContextCompat.startForegroundService(getContext(), servico);
        } catch (Exception recusado) {
            // Android 12+ não deixa COMEÇAR um serviço destes com o app em
            // segundo plano. Se ele já está rodando (o caso normal: começou no
            // play, com o app na frente), basta trocar o texto da notificação.
            try {
                NotificationManagerCompat.from(getContext()).notify(
                    ServicoDeReproducao.ID_NOTIFICACAO,
                    ServicoDeReproducao.notificacao(getContext(), titulo, artista)
                );
            } catch (Exception semPermissao) {
                // sem permissão de notificação: o serviço (se vivo) segue igual
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void liberar(PluginCall call) {
        getContext().stopService(new Intent(getContext(), ServicoDeReproducao.class));
        call.resolve();
    }
}

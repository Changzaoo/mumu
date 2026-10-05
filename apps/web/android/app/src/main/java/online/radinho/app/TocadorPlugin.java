package online.radinho.app;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A ponte do site para o serviço de reprodução (ver ServicoDeReproducao).
 *
 * `window.Capacitor.Plugins.Tocador`:
 *   manterVivo({ titulo, artista, capa, duracaoMs, posicaoMs, tocando })
 *       ao tocar, pausar, trocar de faixa ou saltar — é o que o player do
 *       sistema (barra de status, tela de bloqueio) mostra;
 *   liberar()  depois de um tempo pausado;
 *   evento "comando" { acao, posicaoMs }: a pessoa tocou num botão do player do
 *       sistema ou do fone — acao é tocar, pausar, proxima, anterior ou
 *       posicionar.
 */
@CapacitorPlugin(name = "Tocador")
public class TocadorPlugin extends Plugin {

    @Override
    public void load() {
        ServicoDeReproducao.ouvinte = (acao, posicaoMs) -> {
            JSObject dados = new JSObject();
            dados.put("acao", acao);
            if (posicaoMs >= 0) dados.put("posicaoMs", posicaoMs);
            notifyListeners("comando", dados);
        };
    }

    @PluginMethod
    public void manterVivo(PluginCall call) {
        Intent dados = new Intent(getContext(), ServicoDeReproducao.class)
            .putExtra(ServicoDeReproducao.EXTRA_TITULO, call.getString("titulo"))
            .putExtra(ServicoDeReproducao.EXTRA_ARTISTA, call.getString("artista"))
            .putExtra(ServicoDeReproducao.EXTRA_CAPA, call.getString("capa"))
            .putExtra(ServicoDeReproducao.EXTRA_DURACAO, numero(call, "duracaoMs"))
            .putExtra(ServicoDeReproducao.EXTRA_POSICAO, numero(call, "posicaoMs"))
            .putExtra(ServicoDeReproducao.EXTRA_TOCANDO, call.getBoolean("tocando", true));
        // Serviço já vivo (o caso normal: começou no play, com o app na
        // frente): atualiza por ele. O Android 12+ não deixa COMEÇAR um serviço
        // destes com o app em segundo plano, mas atualizar o que existe pode.
        ServicoDeReproducao vivo = ServicoDeReproducao.instancia;
        if (vivo != null) {
            getActivity().runOnUiThread(() -> vivo.atualizar(dados));
            call.resolve();
            return;
        }
        try {
            ContextCompat.startForegroundService(getContext(), dados);
        } catch (Exception recusado) {
            // em segundo plano e sem serviço: fica para o próximo play com o app na frente
        }
        call.resolve();
    }

    private static long numero(PluginCall call, String chave) {
        Double valor = call.getDouble(chave);
        return valor == null || valor.isNaN() || valor < 0 ? 0 : Math.round(valor);
    }

    @PluginMethod
    public void liberar(PluginCall call) {
        getContext().stopService(new Intent(getContext(), ServicoDeReproducao.class));
        call.resolve();
    }
}

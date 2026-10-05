package online.radinho.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * O que o instalador do sistema responde à atualização pedida pelo
 * AtualizadorPlugin. Quando dá certo o Android troca o app e mata o processo —
 * não há nada a fazer aqui. O único caso com trabalho é o sistema EXIGIR a
 * confirmação da pessoa (Android antigo, ou regra do fabricante): aí é preciso
 * abrir a tela de confirmação que ele mandou.
 */
public class AtualizacaoReceiver extends BroadcastReceiver {

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context contexto, Intent resposta) {
        int estado = resposta.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (estado != PackageInstaller.STATUS_PENDING_USER_ACTION) return;
        Intent confirmar = resposta.getParcelableExtra(Intent.EXTRA_INTENT);
        if (confirmar == null) return;
        try {
            contexto.startActivity(confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception emSegundoPlano) {
            // Com o app em segundo plano o Android não deixa abrir tela: a barra
            // "Atualizar" continua lá e o toque nela refaz o pedido na frente.
        }
    }
}

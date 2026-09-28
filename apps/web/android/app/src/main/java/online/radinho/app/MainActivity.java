package online.radinho.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * O APP NÃO DESENHA EMBAIXO DA BARRA DE STATUS.
 *
 * Com targetSdk 35+ o Android 15 força edge-to-edge: o WebView ocupa a tela
 * inteira, por baixo da barra de status e da de navegação. O layout web só
 * reservava o fundo (safe-area-inset-bottom) e botões do topo ficavam sob o
 * relógio/ícones — visíveis, mas impossíveis de tocar.
 *
 * Em vez de caçar cada tela no CSS (topo, player em tela cheia, diálogos,
 * onboarding…), o WebView ganha MARGEM do tamanho das barras e do recorte da
 * câmera. Nenhum toque cai na barra, e o CSS recebe inset 0 — o que já existe
 * no layout segue funcionando igual. O teclado não entra aqui: quem cuida dele
 * é o adjustResize do Capacitor.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // O vão das barras mostra o fundo da janela: preto, como o app, com
        // ícones claros por cima (senão ficariam brancos no branco).
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);
        WindowInsetsControllerCompat barras =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        barras.setAppearanceLightStatusBars(false);
        barras.setAppearanceLightNavigationBars(false);

        View webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets barras = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            lp.topMargin = barras.top;
            lp.bottomMargin = barras.bottom;
            lp.leftMargin = barras.left;
            lp.rightMargin = barras.right;
            v.setLayoutParams(lp);
            // Já consumido: o WebView não repassa esses insets ao CSS, senão o
            // espaço seria reservado duas vezes (margem + env()).
            return WindowInsetsCompat.CONSUMED;
        });
    }
}

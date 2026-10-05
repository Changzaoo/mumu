package online.radinho.app;

import android.os.CancellationSignal;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * LOGIN COM GOOGLE DENTRO DO APP.
 *
 * O Google não aceita login por página dentro de WebView, e o Android manda a
 * ida ao Google para o navegador do sistema: o login terminava LÁ e o app
 * ficava numa página preta. Aqui o próprio Android mostra a folha de contas do
 * aparelho e devolve um ID token; o site troca esse token pela sessão do
 * Firebase (`signInWithCredential`) sem sair do app.
 *
 * `window.Capacitor.Plugins.LoginGoogle.entrar()` → `{ idToken }`.
 * Rejeita com o código "cancelado" quando a pessoa fecha a folha.
 *
 * Só funciona se a impressão SHA-1 da chave que assina o APK estiver no app
 * Android do projeto Firebase — sem ela o Google recusa com erro de
 * configuração.
 */
@CapacitorPlugin(name = "LoginGoogle")
public class LoginGooglePlugin extends Plugin {

    /** Cliente OAuth "web" do projeto: é para ELE que o token é emitido. */
    private static final String CLIENTE_WEB =
        "1057880563795-oquq40qh1dtenocd9du5b0g8d5ivd9v3.apps.googleusercontent.com";

    @PluginMethod
    public void entrar(PluginCall call) {
        GetCredentialRequest pedido = new GetCredentialRequest.Builder()
            .addCredentialOption(new GetSignInWithGoogleOption.Builder(CLIENTE_WEB).build())
            .build();
        CredentialManager.create(getContext()).getCredentialAsync(
            getActivity(),
            pedido,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse resposta) {
                    Credential credencial = resposta.getCredential();
                    if (credencial instanceof CustomCredential
                        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credencial.getType())) {
                        JSObject saida = new JSObject();
                        saida.put("idToken", GoogleIdTokenCredential.createFrom(credencial.getData()).getIdToken());
                        call.resolve(saida);
                        return;
                    }
                    call.reject("O Google devolveu uma credencial que o app não entende.", "desconhecida");
                }

                @Override
                public void onError(@NonNull GetCredentialException erro) {
                    boolean cancelou = erro instanceof GetCredentialCancellationException;
                    call.reject(String.valueOf(erro.getMessage()), cancelou ? "cancelado" : erro.getType());
                }
            }
        );
    }
}

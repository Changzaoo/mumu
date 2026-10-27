#!/usr/bin/env bash
# vnmax — passo 1 do docs/vnmax-equilibrio.md (precisa de sudo; o Vinicius roda):
#   sudo bash /home/v/vnmax/passo1-kernel-e-servicos.sh
# Libera os 320 MB que o kdump reserva (crashkernel) e tira serviços de VM e
# do apport de um notebook físico. Termina pedindo o reboot (não reinicia sozinho).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
echo "== antes"; free -m | sed -n 2,3p; cat /sys/kernel/kexec_crash_size

echo "== kdump-tools: desliga e tira crashkernel do boot"
systemctl disable --now kdump-tools 2>/dev/null || true
if [[ -f /etc/default/grub.d/kdump-tools.cfg ]]; then
  mv /etc/default/grub.d/kdump-tools.cfg /etc/default/grub.d/kdump-tools.cfg.desligado-20261027
fi
apt-get purge -y kdump-tools linux-crashdump 2>/dev/null || true
update-grub
grep -o "crashkernel=[^ ]*" /boot/grub/grub.cfg | head -1 || echo "crashkernel fora do grub.cfg"

echo "== serviços de máquina virtual e apport (notebook físico)"
apt-get purge -y open-vm-tools vgauth apport apport-core-dump-handler apport-symptoms 2>/dev/null || true
apt-get autoremove -y --purge
systemctl disable --now apport 2>/dev/null || true

echo "== pronto. Reinicie para liberar a reserva do kernel:"
echo "   sudo reboot"
echo "   (depois: free -m deve mostrar ~320 MB a mais em 'total')"

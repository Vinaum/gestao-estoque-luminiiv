import { h } from '../../lib/html.js';
import { papelAtual } from '../../lib/estado.js';

export const STATUS_COMPRA = {
  planejada: ['Planejada', 'status-neutro'],
  aguardando_aprovacao: ['Aguardando aprovação', 'status-warn'],
  aprovada: ['Aprovada', 'status-ok'],
  pedido_realizado: ['Pedido realizado', 'status-ok'],
  parcialmente_recebido: ['Parcialmente recebida', 'status-warn'],
  recebido: ['Recebida', 'status-ok'],
  cancelado: ['Cancelada', 'status-neutro'],
};
export const pillCompra = (s) => { const [r, c] = STATUS_COMPRA[s] || [s, 'status-neutro']; return h`<span class="status-pill ${c}">${r}</span>`; };
export const podeAprovar = () => ['sindico', 'superadmin'].includes(papelAtual());
export const EM_ABERTO = ['planejada', 'aguardando_aprovacao', 'aprovada', 'pedido_realizado', 'parcialmente_recebido'];

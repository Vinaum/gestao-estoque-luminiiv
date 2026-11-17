// Carrega o Chart.js (arquivo local, versão fixa) só quando uma tela de gráficos é aberta.
let promessa = null;
export function carregarChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  promessa ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '../vendor/chart-4.4.7.umd.js';
    s.onload = () => res(window.Chart);
    s.onerror = () => { promessa = null; rej(new Error('Não foi possível carregar os gráficos.')); };
    document.head.appendChild(s);
  });
  return promessa;
}
export const CORES = ['#2f6e5e', '#c1502e', '#e0942f', '#3c7a99', '#8a5a9c', '#5b6b68', '#7a9e3f', '#b5446e'];
const vivos = new WeakMap();
// Desenha (ou redesenha) um gráfico no <canvas>, sem acumular instâncias.
export async function desenharGrafico(canvas, config) {
  const Chart = await carregarChart();
  vivos.get(canvas)?.destroy();
  const c = new Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, animation: false, ...(config.options || {}) } });
  vivos.set(canvas, c);
  return c;
}

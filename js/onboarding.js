// Онбординг: приветствие, согласие, цель, точка А, скриншоты, точка Б, готово. Прогресс сохраняется
import { $, esc, state, tg, toast, haptic, store } from './core.js';
import * as data from './data.js';
import { openPage, closePage } from './ui.js';
import { metricFields, mountShots } from './forms.js';

const STEPS = 7;

export const needsOnboarding = (D) => !D.profile.onboarding?.done && !!D.checkpoints.find((c) => c.idx === 0);

export function runOnboarding(onFinish) {
  const D = state.D;
  const cp0 = D.checkpoints.find((c) => c.idx === 0);
  let step = Math.min(D.profile.onboarding?.step ?? 0, STEPS - 1);

  const go = (n) => { step = n; data.setOnboarding({ step }); draw(); };
  const dots = () => `<div class="step-dots">${Array.from({ length: STEPS }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
  const nav = (next = 'Дальше', back = true) => `<div class="btns">
    ${back && step > 0 ? '<button class="btn" data-back2><span class="ink">Назад</span></button>' : ''}
    <button class="btn pri" style="flex:1" data-next><span class="onlime">${next}</span></button></div>`;

  function draw() {
    const screens = [welcome, consent, goalStep, pointA, shotsA, pointB, finish];
    openPage(`${dots()}<div class="stack" id="obBody"></div>`, (body) => {
      screens[step]($('#obBody', body));
      const nx = body.querySelector('[data-next]'), bk = body.querySelector('[data-back2]');
      if (bk) bk.onclick = () => go(step - 1);
    }, { back: false, title: '' });
  }

  function welcome(el) {
    el.innerHTML = `<div class="card"><span class="plate lime"><span class="onlime">Добро пожаловать</span></span>
      <h2 class="h1s"><span class="ink">Привет, ${esc(D.profile.display_name)}</span></h2>
      <p class="dim">Это твой трекер на программе Barbermaxxing. Он показывает путь от того, где ты сейчас, к тому, куда хочешь прийти</p></div>
      <div class="row static"><span class="ico">✅</span><span class="row-main"><span class="ink t">Что отмечаю каждый день</span><span class="dim cap">Уроки, домашки, видео. 5–10 минут</span></span></div>
      <div class="row static"><span class="ico">📊</span><span class="row-main"><span class="ink t">Что вношу раз в 2 недели</span><span class="dim cap">Цифры и скриншоты, минут на 10</span></span></div>
      <div class="row static"><span class="ico">🧭</span><span class="row-main"><span class="ink t">Что вижу</span><span class="dim cap">Свой путь, опыт, уровни и выводы</span></span></div>
      ${nav('Начать', false)}`;
    el.querySelector('[data-next]').onclick = async () => {
      try { tg && tg.requestWriteAccess && tg.requestWriteAccess(() => {}); } catch (e) {}
      go(1);
    };
  }
  function consent(el) {
    el.innerHTML = `<div class="card"><div class="h"><span class="ink">Что мы храним</span></div><p class="ink">${esc(D.settings.consent_text || '')}</p></div>${nav('Согласен')}`;
    el.querySelector('[data-next]').onclick = async () => { await data.setOnboarding({ consent_at: new Date().toISOString(), step: 2 }); step = 2; draw(); };
  }
  function goalStep(el) {
    el.innerHTML = `<div class="card"><div class="h"><span class="ink">Чего хочешь добиться</span></div>
      <p class="dim cap">Своими словами, по итогам программы</p>
      <textarea class="field area" id="goalIn" maxlength="400" placeholder="Например: полная запись и средний чек выше">${esc(D.goalText || '')}</textarea></div>${nav()}`;
    let t; el.querySelector('#goalIn').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => data.saveGoalText(e.target.value), 500); });
    el.querySelector('[data-next]').onclick = async () => { await data.saveGoalText(el.querySelector('#goalIn').value); go(3); };
  }
  function pointA(el) {
    el.innerHTML = `<div class="card"><span class="plate"><span class="onlime">Где ты сейчас</span></span><p class="dim cap">Это твоя точка А, старт. Любую цифру можно пропустить</p><div class="stack-s" id="mf"></div></div>${nav()}`;
    metricFields(el.querySelector('#mf'), {
      getVal: (k) => D.goals[k]?.a,
      onSave: (k, v) => { data.saveGoal(k, 'a', v); data.saveCpValue(cp0.id, k, v); },
    });
    el.querySelector('[data-next]').onclick = () => go(4);
  }
  function shotsA(el) {
    el.innerHTML = `<div class="card"><span class="plate"><span class="onlime">Скриншоты со старта</span></span>
      <p class="ink">${esc(D.settings.screenshot_help || '')}</p><div id="sh"></div></div>${nav()}`;
    mountShots(el.querySelector('#sh'), cp0.id);
    el.querySelector('[data-next]').onclick = () => go(5);
  }
  function pointB(el) {
    el.innerHTML = `<div class="card"><span class="plate lime"><span class="onlime">Куда хочешь прийти</span></span>
      <p class="dim cap">Это твоя точка Б, цель. Это ориентир и обещанием не является. Любую цифру можно пропустить</p><div class="stack-s" id="mf"></div></div>${nav()}`;
    metricFields(el.querySelector('#mf'), { getVal: (k) => D.goals[k]?.b, onSave: (k, v) => data.saveGoal(k, 'b', v) });
    el.querySelector('[data-next]').onclick = () => go(6);
  }
  function finish(el) {
    el.innerHTML = `<div class="card" style="align-items:center;text-align:center"><span class="plate lime"><span class="onlime">Готово</span></span>
      <h2 class="h1s"><span class="ink">Путь начат</span></h2><p class="dim">Точка А записана. Дальше отмечай, что сделал, а раз в 2 недели вноси цифры</p></div>${nav('Открыть трекер')}`;
    el.querySelector('[data-next]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      await data.submitCheckpoint(cp0.id);
      await data.setOnboarding({ done: true, step: STEPS });
      haptic(); closePage(); onFinish && onFinish();
    };
  }
  draw();
}

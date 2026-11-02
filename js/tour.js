// Обучение пользованию приложением: показывается один раз при первом входе, запускается повторно из Профиля
import { $, state } from './core.js';
import * as data from './data.js';
import { openPage, closePage } from './ui.js';

const SLIDES = [
  { ico: '👋', tag: 'Обучение', title: 'Как пользоваться трекером', text: 'Покажем за минуту, где что лежит. Внизу шесть вкладок, на компьютере они слева. Обучение можно пропустить и запустить снова в Профиле',
    rows: [] },
  { ico: '☀️', tag: 'Вкладка «Сегодня»', title: 'Главный экран на каждый день', text: 'Здесь твой уровень, неделя программы и то, что на сегодня',
    rows: [['✅', 'Отмечай сделанное', 'Нажми на пункт, и опыт начислится сразу. Передумал, нажми ещё раз'], ['🎥', 'Записать видео', 'Кнопка на экране, когда снял ролик. Просмотры и ссылку можно добавить позже']] },
  { ico: '🧭', tag: 'Вкладка «Путь»', title: 'От старта к цели', text: 'Линия показывает, как ты идёшь от точки А к точке Б',
    rows: [['📍', 'Старт, Цель, Сейчас', 'Нажимай на точки, увидишь цифры'], ['📊', 'Замеры', 'Раз в 2 недели вноси цифры и скриншоты. Замер открывается за 2 дня до срока'], ['🖼️', 'Галерея', 'Все скриншоты по замерам в одном месте']] },
  { ico: '📈', tag: 'Вкладка «Прогресс»', title: 'Графики', text: 'Прохождение программы, опыт, видео и твои цифры. График появляется, когда есть две точки и больше',
    rows: [] },
  { ico: '📚', tag: 'Вкладка «Программа»', title: 'Недели по порядку', text: 'Модуль 0 открыт сразу, следующие недели открываются по очереди. Нажми на пункт, откроется описание и место для конспекта',
    rows: [] },
  { ico: '✍️', tag: 'Вкладка «Выводы»', title: 'Твои заметки и вопросы', text: 'Записывай, что понял за день, и задавай вопросы. Это видишь только ты, команда программы туда не заглядывает',
    rows: [] },
  { ico: '🏅', tag: 'Опыт и награды', title: 'Опыт копится сам', text: 'Каждая отметка даёт опыт. Растёт уровень, меняется звание, открываются ачивки. Если снял отметку, опыт возвращается',
    rows: [] },
  { ico: '👤', tag: 'Вкладка «Профиль»', title: 'Всё остальное', text: 'Звания, ачивки, тариф и даты созвонов, итог программы в PDF, уведомления от бота и корзина с удалённым. Здесь же можно пройти обучение ещё раз',
    rows: [] },
];

export const needsTour = (D) => !D.profile.onboarding?.tour_done;

export function runTour(onFinish) {
  let i = 0;
  const finish = async () => {
    closePage();
    if (!state.D.profile.onboarding?.tour_done) { try { await data.setOnboarding({ tour_done: true }); } catch (e) {} }
    onFinish && onFinish();
  };
  function draw() {
    const s = SLIDES[i], last = i === SLIDES.length - 1;
    const dots = `<div class="step-dots">${SLIDES.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>`;
    openPage(`${dots}<div class="card" style="align-items:center;text-align:center"><span class="tour-ico" aria-hidden="true">${s.ico}</span>
        <span class="plate lime"><span class="onlime">${s.tag}</span></span>
        <h2 class="h1s"><span class="ink">${s.title}</span></h2><p class="dim">${s.text}</p></div>
      ${s.rows.map(([e, t, c]) => `<div class="row static"><span class="ico">${e}</span><span class="row-main"><span class="ink t">${t}</span><span class="dim cap">${c}</span></span></div>`).join('')}
      <div class="btns">${i > 0 ? '<button class="btn" data-prev><span class="ink">Назад</span></button>' : '<button class="btn" data-skip><span class="ink">Пропустить</span></button>'}
        <button class="btn pri" style="flex:1" data-next><span class="onlime">${last ? 'Готово' : 'Дальше'}</span></button></div>`,
    (body) => {
      const q = (a) => body.querySelector(a);
      q('[data-next]').onclick = () => { if (last) finish(); else { i++; draw(); } };
      if (q('[data-prev]')) q('[data-prev]').onclick = () => { i--; draw(); };
      if (q('[data-skip]')) q('[data-skip]').onclick = finish;
    }, { back: false, title: '' });
  }
  draw();
}

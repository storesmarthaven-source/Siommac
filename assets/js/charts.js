// Chart rendering helpers for Chart.js.
window.SiomacCharts = (function () {
  let attendanceChartInstance = null;
  let trendChartInstance = null;
  const dashCharts = {};

  function destroyDash_(key) { if (dashCharts[key]) { dashCharts[key].destroy(); delete dashCharts[key]; } }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexAlpha(hex, alpha) {
    const m = hex.replace('#', '');
    const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const r = parseInt(v.substr(0, 2), 16), g = parseInt(v.substr(2, 2), 16), b = parseInt(v.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function displayAttendanceChart(stats) {
    const canvas = document.getElementById('attendanceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (attendanceChartInstance) attendanceChartInstance.destroy();

    attendanceChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Absent', 'Sundays'],
        datasets: [{
          data: [stats.present, stats.absent, stats.sundays],
          backgroundColor: ['#34a853', '#ea4335', '#0074D9'],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 10, usePointStyle: true, font: { size: 11 } } } },
        cutout: '60%'
      }
    });
  }

  function renderTrendLine(data) {
    destroyDash_('trend');
    const canvas = document.getElementById('trendLineChart');
    if (!canvas) return;
    const accent = cssVar('--navy-accent') || '#0074D9';
    dashCharts.trend = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => String(d.date).slice(5)),
        datasets: [{
          label: 'Present',
          data: data.map(d => d.present),
          borderColor: accent,
          backgroundColor: hexAlpha(accent, 0.18),
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: accent
        }, {
          label: 'Late',
          data: data.map(d => d.late),
          borderColor: '#fbbc04',
          backgroundColor: hexAlpha('#fbbc04', 0.10),
          borderWidth: 2,
          fill: false,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderDash: [4, 4]
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 11 } } } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f0f0f0' } },
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } }
        }
      }
    });
  }

  function renderDeptDist(data) {
    destroyDash_('dept');
    const canvas = document.getElementById('deptDistChart');
    if (!canvas) return;
    const palette = [cssVar('--navy-primary'), cssVar('--navy-accent'), '#34a853', '#fbbc04', '#ea4335', '#8b5cf6', '#00afb9', '#e91e63'];
    dashCharts.dept = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          data: data.map(d => d.count),
          backgroundColor: data.map((_, i) => palette[i % palette.length]),
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } } },
        cutout: '58%'
      }
    });
  }

  function renderStatusBars(stats) {
    destroyDash_('status');
    const canvas = document.getElementById('statusBarChart');
    if (!canvas) return;
    dashCharts.status = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Present', 'Late', 'Absent', 'On Leave'],
        datasets: [{
          data: [stats.present, stats.late, stats.absent, stats.onLeave],
          backgroundColor: ['#34a853', '#fbbc04', '#ea4335', cssVar('--navy-accent') || '#0074D9'],
          borderRadius: 6,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + ' people' } } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f0f0f0' } },
          x: { ticks: { font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }

  function renderLeaveTypes(types) {
    destroyDash_('leaves');
    const canvas = document.getElementById('leaveTypesChart');
    if (!canvas) return;
    dashCharts.leaves = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Sick', 'Casual', 'Annual', 'Medical'],
        datasets: [{
          data: [types.sick, types.casual, types.annual, types.medical],
          backgroundColor: ['#ea4335', cssVar('--navy-accent') || '#0074D9', '#34a853', '#fbbc04'],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } } },
        cutout: '58%'
      }
    });
  }

  function displayTrendChart(records) {
    const canvas = document.getElementById('attendanceTrendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (trendChartInstance) trendChartInstance.destroy();

    const sorted = records.slice().reverse();
    const labels = sorted.map(r => String(r.date).slice(5));
    const data = sorted.map(r => Number(r.hours) || 0);

    trendChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Hours',
          data,
          backgroundColor: 'rgba(0,116,217,0.75)',
          borderColor: '#0074D9',
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 28
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + ' h' } } },
        scales: {
          y: { beginAtZero: true, suggestedMax: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: '#f0f0f0' } },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } }
        }
      }
    });
  }

  function hasAttendanceChart() { return !!attendanceChartInstance; }
  function hasTrendChart() { return !!trendChartInstance; }
  function renderDashboardCharts(data) {
    renderTrendLine(data.dailyTrend);
    renderDeptDist(data.deptDistribution);
    renderStatusBars(data.statusBreakdown);
    renderLeaveTypes(data.leaveTypes);
  }

  return { displayAttendanceChart, displayTrendChart, renderDashboardCharts, hasAttendanceChart, hasTrendChart };
})();

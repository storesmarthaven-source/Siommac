// Chart rendering — exactly matches SIOMAC industrial design spec
window.SiomacCharts = (function () {
  let attendanceChartInstance = null;
  let trendChartInstance = null;
  const dashCharts = {};

  function destroyDash_(key) { if (dashCharts[key]) { dashCharts[key].destroy(); delete dashCharts[key]; } }

  // Global font
  Chart.defaults.font.family = "'Inter', 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.color = '#5E6F8D';

  // ── Employee: personal attendance donut ──
  function displayAttendanceChart(stats) {
    const canvas = document.getElementById('attendanceChart');
    if (!canvas) return;
    if (attendanceChartInstance) attendanceChartInstance.destroy();
    attendanceChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Absent', 'Sundays'],
        datasets: [{
          data: [stats.present, stats.absent, stats.sundays],
          backgroundColor: ['#2E7D32', '#E40C0C', '#1B2D55'],
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } }
        }
      }
    });
  }

  // ── Admin: 30-day daily attendance trend — matches design line chart exactly ──
  function renderTrendLine(data) {
    destroyDash_('trend');
    const canvas = document.getElementById('trendLineChart');
    if (!canvas) return;
    dashCharts.trend = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => String(d.date).slice(5)),
        datasets: [
          {
            label: 'Present',
            data: data.map(d => d.present),
            borderColor: '#E40C0C',
            backgroundColor: 'rgba(228,12,12,0.08)',
            borderWidth: 2.5,
            tension: 0.5,
            cubicInterpolationMode: 'monotone',
            fill: true,
            pointBackgroundColor: '#E40C0C',
            pointBorderColor: 'white',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: 'Late',
            data: data.map(d => d.late),
            borderColor: '#FFB712',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.5,
            cubicInterpolationMode: 'monotone',
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#FFB712'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, padding: 16 } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: '#E9EEF3' }, ticks: { font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }
        }
      }
    });
  }

  // ── Admin: Department distribution — matches design doughnut exactly ──
  function renderDeptDist(data) {
    destroyDash_('dept');
    const canvas = document.getElementById('deptDistChart');
    if (!canvas) return;
    // Exact palette from design spec
    const palette = ['#E40C0C', '#1B2D55', '#FFB712', '#2A6F9C', '#5E6F8D', '#B23C1C', '#2E7D32', '#7C3AED', '#0891B2', '#DB2777'];
    dashCharts.dept = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          data: data.map(d => d.count),
          backgroundColor: data.map((_, i) => palette[i % palette.length]),
          borderWidth: 0,
          cutout: '65%',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } }
        }
      }
    });
  }

  // ── Admin: Today's status bar chart ──
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
          backgroundColor: [
            'rgba(46,125,50,0.85)',
            'rgba(255,183,18,0.85)',
            'rgba(228,12,12,0.85)',
            'rgba(27,45,85,0.75)'
          ],
          borderColor: ['#2E7D32', '#FFB712', '#E40C0C', '#1B2D55'],
          borderWidth: 0,
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ' ' + c.parsed.y + ' employees' } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: '#E9EEF3' }, ticks: { stepSize: 1, font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        }
      }
    });
  }

  // ── Admin: Leave types doughnut ──
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
          backgroundColor: ['#E40C0C', '#1B2D55', '#2E7D32', '#FFB712'],
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } }
        }
      }
    });
  }

  // ── Employee: personal hours trend bar chart ──
  function displayTrendChart(records) {
    const canvas = document.getElementById('attendanceTrendChart');
    if (!canvas) return;
    if (trendChartInstance) trendChartInstance.destroy();
    const sorted = records.slice().reverse();
    trendChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: sorted.map(r => String(r.date).slice(5)),
        datasets: [{
          label: 'Hours',
          data: sorted.map(r => Number(r.hours) || 0),
          backgroundColor: 'rgba(228,12,12,0.75)',
          borderColor: '#E40C0C',
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 28
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ' ' + c.parsed.y + ' hrs' } }
        },
        scales: {
          y: { beginAtZero: true, suggestedMax: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: '#E9EEF3' } },
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

    // ── Populate left-side stat panels ──
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };

    // Dept stats — match order from deptDistribution array
    (data.deptDistribution || []).forEach((d, i) => {
      set('deptStat' + i, d.count);
    });

    // Status stats
    const s = data.statusBreakdown || {};
    set('statusStatPresent', s.present ?? '—');
    set('statusStatLate',    s.late    ?? '—');
    set('statusStatAbsent',  s.absent  ?? '—');
    set('statusStatLeave',   s.onLeave ?? '—');

    // Leave stats
    const l = data.leaveTypes || {};
    set('leaveStatSick',    l.sick    ?? '—');
    set('leaveStatCasual',  l.casual  ?? '—');
    set('leaveStatAnnual',  l.annual  ?? '—');
    set('leaveStatMedical', l.medical ?? '—');
  }

  // ── Silent in-place update — patches existing chart instances without redraw flicker ──
  function updateDashboardCharts(data) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };

    // Trend line — patch labels + both datasets
    if (dashCharts.trend && data.dailyTrend) {
      const t = dashCharts.trend;
      t.data.labels = data.dailyTrend.map(d => String(d.date).slice(5));
      t.data.datasets[0].data = data.dailyTrend.map(d => d.present);
      t.data.datasets[1].data = data.dailyTrend.map(d => d.late);
      t.update('none'); // 'none' = skip animation for silent update
    }

    // Dept doughnut — patch data + labels
    if (dashCharts.dept && data.deptDistribution) {
      dashCharts.dept.data.labels = data.deptDistribution.map(d => d.name);
      dashCharts.dept.data.datasets[0].data = data.deptDistribution.map(d => d.count);
      dashCharts.dept.update('none');
      (data.deptDistribution || []).forEach((d, i) => set('deptStat' + i, d.count));
    }

    // Status bar — patch data
    if (dashCharts.status && data.statusBreakdown) {
      const s = data.statusBreakdown;
      dashCharts.status.data.datasets[0].data = [s.present, s.late, s.absent, s.onLeave];
      dashCharts.status.update('none');
      set('statusStatPresent', s.present ?? '—');
      set('statusStatLate',    s.late    ?? '—');
      set('statusStatAbsent',  s.absent  ?? '—');
      set('statusStatLeave',   s.onLeave ?? '—');
    }

    // Leave doughnut — patch data
    if (dashCharts.leaves && data.leaveTypes) {
      const l = data.leaveTypes;
      dashCharts.leaves.data.datasets[0].data = [l.sick, l.casual, l.annual, l.medical];
      dashCharts.leaves.update('none');
      set('leaveStatSick',    l.sick    ?? '—');
      set('leaveStatCasual',  l.casual  ?? '—');
      set('leaveStatAnnual',  l.annual  ?? '—');
      set('leaveStatMedical', l.medical ?? '—');
    }
  }

  return { displayAttendanceChart, displayTrendChart, renderDashboardCharts, updateDashboardCharts, hasAttendanceChart, hasTrendChart };
})();

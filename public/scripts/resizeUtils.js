/**
 * Column resize utilities for the trading dashboard
 */

export function setupColumnResizing() {
    if (typeof interact === "undefined") {
        console.error("Interact.js not loaded");
        return;
    }

    // Setup column resizing functionality
    interact('.resize-handle').draggable({
        axis: 'x',
        listeners: {
            move(event) {
                const handle = event.target;
                const handleId = handle.id;
                const dashboard = document.querySelector('.dashboard');
                const dashboardRect = dashboard.getBoundingClientRect();
                
                if (handleId === 'resize1') {
                    // Resizing between column 1 and column 2
                    const column1 = document.getElementById('column1');
                    const column1Rect = column1.getBoundingClientRect();
                    
                    const newWidth = Math.min(Math.max(column1Rect.width + event.dx, 200), dashboardRect.width * 0.5);
                    const newPercent = (newWidth / dashboardRect.width) * 100;
                    
                    column1.style.flex = `0 0 ${newPercent}%`;
                    
                } else if (handleId === 'resize2') {
                    // Resizing between column 2 and column 3
                    const column3 = document.getElementById('column3');
                    const column3Rect = column3.getBoundingClientRect();
                    
                    const newWidth = Math.min(Math.max(column3Rect.width - event.dx, 150), dashboardRect.width * 0.3);
                    const newPercent = (newWidth / dashboardRect.width) * 100;
                    
                    column3.style.flex = `0 0 ${newPercent}%`;
                }
                
                // Debounced chart resize
                clearTimeout(window.resizeTimeout);
                window.resizeTimeout = setTimeout(() => {
                    triggerChartResize();
                }, 100);
            }
        }
    });
}

function triggerChartResize() {
    // Trigger chart resize after column resize
    if (window.tradesChart) window.tradesChart.resize();
    if (window.orderBookChart) window.orderBookChart.resize();
    if (window.delayGauge) window.delayGauge.update();
}
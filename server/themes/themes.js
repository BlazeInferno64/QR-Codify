export const QR_THEMES = {
    cyber: {
        background: '#0b0f19',
        isLiquid: true,
        finderOuterRadiusScale: 2.0, 
        finderInnerRadiusScale: 1.2,
        isFinderEyeCircle: true,
        getFill: (ctx, qrSize) => {
            const grad = ctx.createLinearGradient(0, 0, qrSize, qrSize);
            grad.addColorStop(0.0, '#3b82f6'); 
            grad.addColorStop(0.5, '#8b5cf6'); 
            grad.addColorStop(1.0, '#ec4899'); 
            return grad;
        }
    },
    tokyonight: {
        background: '#1a1b26',
        isLiquid: true,
        finderOuterRadiusScale: 1.6,
        finderInnerRadiusScale: 1.0,
        isFinderEyeCircle: false,
        getFill: (ctx, qrSize) => {
            const grad = ctx.createLinearGradient(0, qrSize, qrSize, 0);
            grad.addColorStop(0.0, '#7aa2f7'); 
            grad.addColorStop(0.5, '#bb9af7'); 
            grad.addColorStop(1.0, '#f7768e'); 
            return grad;
        }
    },
    neon: {
        background: '#050505',
        isLiquid: false, 
        finderOuterRadiusScale: 1.4,
        finderInnerRadiusScale: 0.8,
        isFinderEyeCircle: false,
        getFill: (ctx, qrSize) => {
            const grad = ctx.createLinearGradient(0, 0, 0, qrSize);
            grad.addColorStop(0.0, '#00ffcc'); 
            grad.addColorStop(1.0, '#99ff00'); 
            return grad;
        }
    }
};

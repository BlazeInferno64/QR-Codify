export const QR_THEMES = {
    // === CYBER THEME ===
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

    // === TOKYO NIGHT THEME ===
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

    // === NEON THEME ===
    neon: {
        background: '#050505',
        isLiquid: false,
        finderOuterRadiusScale: 1.0,
        finderInnerRadiusScale: 1.0,
        isFinderEyeCircle: false,
        getFill: (ctx, qrSize) => {
            const grad = ctx.createLinearGradient(0, 0, qrSize, 0);
            grad.addColorStop(0.0, '#00ff66');
            grad.addColorStop(1.0, '#00ffff');
            return grad;
        }
    },

    // === GLITCH THEME ===
    glitch: {
        background: '#0d0d0d',
        isLiquid: false,
        finderOuterRadiusScale: 1.2,
        finderInnerRadiusScale: 1.4,
        isFinderEyeCircle: true,
        getFill: (ctx, qrSize) => {
            const grad = ctx.createLinearGradient(0, 0, 0, qrSize);
            grad.addColorStop(0.0, '#ff0055');
            grad.addColorStop(0.5, '#00ffaa');
            grad.addColorStop(1.0, '#0055ff');
            return grad;
        }
    }
};
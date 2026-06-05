import React from 'react';

export const LandingView: React.FC = () => {
  const MOON_LOGO = "https://pulgardigital.org/wp-content/uploads/2026/01/logo.png";

  return (
    <div className="min-h-screen star-bg flex items-center justify-center p-6 relative overflow-hidden">
      <div className="max-w-3xl w-full text-center relative z-10">
        <div className="mb-12">
          <div className="mb-6 animate-float inline-block relative">
            <div className="absolute inset-0 bg-yellow-400/10 rounded-full blur-3xl scale-150 animate-pulse"></div>
            <img src={MOON_LOGO} alt="Infomuns Logo" className="w-48 h-48 md:w-64 md:h-64 object-contain relative z-10 drop-shadow-[0_10px_30px_rgba(0,0,0,0.3)]" />
          </div>
          <h1 className="text-6xl md:text-8xl font-sans-rounded font-black text-white mb-4 tracking-tight drop-shadow-lg">
            Info<span className="text-indigo-400">muns</span>
          </h1>
          <p className="text-white text-xl md:text-2xl font-sans-rounded max-w-xl mx-auto leading-relaxed drop-shadow-md">
            Noticias de la Tierra contadas por los Muns para los más pequeños.
          </p>
        </div>
      </div>

      {/* Floating Sparkles */}
      <div className="absolute top-20 right-[15%] text-2xl animate-pulse text-yellow-200">✨</div>
      <div className="absolute bottom-40 left-[10%] text-xl animate-bounce text-indigo-300" style={{ animationDelay: '0.7s' }}>⭐</div>
    </div>
  );
};

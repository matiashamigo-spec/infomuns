
import React from 'react';

interface MagicButtonProps {
  onClick: () => void;
  isLoading: boolean;
}

export const MagicButton: React.FC<MagicButtonProps> = ({ onClick, isLoading }) => {
  const MOON_LOGO = "https://pulgardigital.org/wp-content/uploads/2026/01/logo.png";

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`
        fixed bottom-8 right-8 z-50
        group flex items-center justify-center
        w-28 h-28 rounded-full
        bg-gradient-to-br from-indigo-600 to-purple-700
        hover:from-indigo-500 hover:to-purple-600
        text-white
        shadow-[0_0_50px_rgba(129,140,248,0.6)]
        hover:shadow-[0_0_70px_rgba(253,224,71,0.5)]
        transition-all duration-500 transform hover:scale-110 hover:-translate-y-3
        border-4 border-white/30
        disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none
      `}
      aria-label="Transformar noticia a Muns"
    >
      {isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 border-4 border-yellow-300 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
            <img 
              src={MOON_LOGO} 
              alt="Muns Button" 
              className="w-20 h-20 relative z-10 animate-float drop-shadow-[0_5px_15px_rgba(0,0,0,0.3)] group-hover:rotate-6 transition-transform duration-500 object-contain" 
            />
            {/* Magical particles */}
            <span className="absolute top-2 right-4 text-2xl animate-pulse text-yellow-300 drop-shadow-sm">✨</span>
            <span className="absolute bottom-4 left-4 text-sm animate-bounce text-yellow-100" style={{ animationDelay: '0.5s' }}>⭐</span>
            <span className="absolute top-8 left-4 text-xs animate-pulse text-indigo-200" style={{ animationDelay: '1.2s' }}>✦</span>
        </>
      )}
      
      {/* Tooltip Label */}
      <div className="absolute bottom-full mb-6 right-0 px-6 py-3 bg-indigo-900/90 backdrop-blur-md text-white text-sm font-black rounded-2xl shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap pointer-events-none font-sans-rounded transform translate-y-4 group-hover:translate-y-0 border border-white/20 flex items-center gap-2">
        <span className="text-yellow-300">✨</span> ¡Ver versión mágica!
      </div>
    </button>
  );
};

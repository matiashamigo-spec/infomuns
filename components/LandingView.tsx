
import React from 'react';

interface LandingViewProps {
  urlInput: string;
  setUrlInput: (url: string) => void;
  onFetch: (e: React.FormEvent) => void;
  isLoading: boolean;
}

export const LandingView: React.FC<LandingViewProps> = ({ urlInput, setUrlInput, onFetch, isLoading }) => {
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

        <div className="max-w-2xl mx-auto">
          <form onSubmit={onFetch} className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <div className="relative flex flex-col sm:flex-row gap-3 bg-white/10 backdrop-blur-xl p-3 rounded-2xl border border-white/20 shadow-2xl">
              <input 
                type="url" 
                required
                placeholder="Pega el link de la noticia aquí..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="flex-1 bg-white/20 text-white placeholder:text-slate-300 rounded-xl px-6 py-4 text-xl focus:outline-none border border-transparent transition-all font-sans-rounded"
              />
              <button 
                type="submit"
                disabled={isLoading || !urlInput.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-4 rounded-xl text-xl font-black transition-all active:scale-95 flex items-center justify-center gap-2 font-sans-rounded shadow-lg"
              >
                {isLoading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Transformar ✨"}
              </button>
            </div>
          </form>
          
          <p className="mt-8 text-white/60 font-sans-rounded text-sm font-bold uppercase tracking-widest">
            Abre tu bolso de sonrisas y prepárate para el cohete lunar
          </p>
        </div>
      </div>

      {/* Floating Sparkles */}
      <div className="absolute top-20 right-[15%] text-2xl animate-pulse text-yellow-200">✨</div>
      <div className="absolute bottom-40 left-[10%] text-xl animate-bounce text-indigo-300" style={{ animationDelay: '0.7s' }}>⭐</div>
    </div>
  );
};

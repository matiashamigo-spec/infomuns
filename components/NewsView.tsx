
import React from 'react';
import { NewsArticle } from '../types';

interface NewsViewProps {
  article: NewsArticle;
}

export const NewsView: React.FC<NewsViewProps> = ({ article }) => {
  const MOON_LOGO = "https://pulgardigital.org/wp-content/uploads/2026/01/logo.png";

  return (
    <article className="max-w-4xl mx-auto bg-white min-h-screen shadow-2xl shadow-slate-200 animate-fade-in">
      {/* News Brand Header */}
      <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center border-b border-slate-800">
        <div className="flex items-center gap-3">
          <img src={MOON_LOGO} alt="Mun logo" className="w-10 h-10 object-contain" />
          <div className="font-black text-xl tracking-tighter font-sans-rounded italic">INFO<span className="text-indigo-400 underline decoration-indigo-500/50">MUNS</span></div>
        </div>
        <div className="text-[10px] md:text-xs uppercase tracking-widest text-gray-400 font-medium bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
          {article.date || 'Edición Terrestre'}
        </div>
      </div>

      <div className="px-6 md:px-16 pt-12 pb-32">
        {/* Category Badge */}
        <div className="mb-6">
          <span className="bg-indigo-50 text-indigo-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border border-indigo-100 shadow-sm">
            {article.category}
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 mb-8 leading-tight font-serif tracking-tight">
          {article.headline}
        </h1>

        {/* Hero Image */}
        <div className="group relative w-full aspect-[16/9] bg-slate-100 mb-10 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-slate-200">
          <img 
            src={article.imageUrl} 
            alt={article.headline} 
            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=2070&auto=format&fit=crop';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent opacity-60" />
        </div>

        {/* Article Body */}
        <div className="max-w-2xl mx-auto">
           {/* Byline */}
           <div className="flex items-center gap-4 mb-10 pb-8 border-b border-slate-100">
              <div className="w-14 h-14 rounded-full bg-slate-900 flex items-center justify-center text-white font-bold shadow-md">
                <img src={MOON_LOGO} className="w-10 h-10 object-contain" alt="M" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Corresponsal Terrestre</p>
                <p className="text-xs text-slate-500">Recibido en la Estación Infomuns</p>
              </div>
           </div>

          <div className="prose prose-slate prose-lg max-w-none text-slate-700 font-serif leading-relaxed">
            {article.content.split('\n').map((paragraph, idx) => (
              paragraph.trim() && (
                <p key={idx} className="mb-6 text-lg md:text-xl selection:bg-indigo-100">
                  {paragraph}
                </p>
              )
            ))}
          </div>

          <div className="mt-20 pt-10 border-t border-slate-100 text-center">
             <div className="inline-block p-4 rounded-full bg-slate-50 mb-4 animate-float">
                <img src={MOON_LOGO} className="w-12 h-12 grayscale opacity-50 object-contain" alt="Mun footer" />
             </div>
             <p className="text-slate-400 text-sm font-sans-rounded font-medium italic">Todo listo para la transformación mágica.</p>
          </div>
        </div>
      </div>
    </article>
  );
};

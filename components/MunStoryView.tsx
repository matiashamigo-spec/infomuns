
import React from 'react';
import { MunStory } from '../types';

interface MunStoryViewProps {
  story: MunStory;
  onClose: () => void;
}

export const MunStoryView: React.FC<MunStoryViewProps> = ({ story, onClose }) => {
  const MOON_LOGO = "https://pulgardigital.org/wp-content/uploads/2026/01/logo.png";

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto star-bg text-white animate-fade-in flex flex-col">
      <button 
        onClick={onClose}
        className="fixed top-6 right-6 z-50 bg-indigo-600/50 hover:bg-indigo-600 rounded-full p-4 backdrop-blur-md transition-all border border-white/20 shadow-2xl group"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex-1 flex flex-col items-center py-12 px-4 md:px-8">
        <div className="max-w-3xl w-full">
          <div className="flex flex-col items-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-yellow-400/20 rounded-full blur-[60px] animate-pulse"></div>
              <img src={MOON_LOGO} alt="Mun Story" className="w-32 h-32 relative z-10 animate-float object-contain" />
            </div>
          </div>

          <div className="bg-slate-900/60 backdrop-blur-3xl rounded-[2.5rem] p-8 md:p-12 border border-white/10 shadow-[0_0_80px_rgba(79,70,229,0.15)] relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-400 to-transparent"></div>
            
            <h2 className="text-2xl md:text-4xl font-sans-rounded font-black text-center text-yellow-300 mb-10 leading-tight drop-shadow-md">
              {story.title}
            </h2>

            <div className="font-sans-rounded text-lg md:text-xl leading-relaxed text-indigo-50 space-y-6 font-normal">
              {story.story.split('\n').map((paragraph, idx) => (
                 paragraph.trim() && (
                   <p key={idx} className="animate-fade-in">
                     {paragraph}
                   </p>
                 )
              ))}
            </div>
            
            <div className="mt-12 pt-8 border-t border-white/5 flex flex-col items-center gap-4">
              <p className="text-xs uppercase tracking-[0.4em] font-black text-indigo-400/60">
                Crónica de la Luz • Sin Edad
              </p>
              <div className="flex gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

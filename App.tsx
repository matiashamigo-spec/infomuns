
import React, { useState } from 'react';
import { LandingView } from './components/LandingView';
import { MunStoryView } from './components/MunStoryView';
import { generateMunStory, fetchNewsFromUrl } from './services/geminiService';
import { AppMode, MunStory } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.LANDING);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<'FETCH' | 'TRANSFORM' | null>(null);
  const [munStory, setMunStory] = useState<MunStory | null>(null);
  const [urlInput, setUrlInput] = useState('');

  const MOON_LOGO = "https://pulgardigital.org/wp-content/uploads/2026/01/logo.png";

  const handleFetchAndTransform = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setIsLoading(true);
    setLoadingStep('FETCH');
    setMunStory(null); 

    try {
      const article = await fetchNewsFromUrl(urlInput);
      if (!article) {
        alert("No pudimos captar la señal de esa noticia. Prueba con otro enlace.");
        setIsLoading(false);
        return;
      }

      setLoadingStep('TRANSFORM');
      const story = await generateMunStory(article.headline + "\n" + article.content);
      setMunStory(story);
      
      setMode(AppMode.MUNS);
    } catch (error) {
      console.error("Error en el proceso:", error);
      alert("Opaq ha oscurecido la señal. Prueba de nuevo en un momento.");
    } finally {
      setIsLoading(false);
      setLoadingStep(null);
    }
  };

  const resetToLanding = () => {
    setUrlInput('');
    setMunStory(null);
    setMode(AppMode.LANDING);
  };

  return (
    <div className="min-h-screen">
      {mode === AppMode.LANDING && (
        <LandingView 
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          onFetch={handleFetchAndTransform}
          isLoading={isLoading}
        />
      )}

      {mode === AppMode.MUNS && munStory && (
        <MunStoryView 
          story={munStory} 
          onClose={resetToLanding} 
        />
      )}

      {isLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/95 backdrop-blur-xl">
           <div className="text-center text-white px-6">
              <img src={MOON_LOGO} className="w-24 h-24 animate-bounce mx-auto mb-6" />
              <p className="font-black text-2xl mb-4 font-sans-rounded">
                {loadingStep === 'FETCH' ? 'Captando señal de la Tierra...' : 'los Muns están escribiendo el cuento...'}
              </p>
              <div className="w-64 h-2 bg-white/10 rounded-full mx-auto overflow-hidden">
                <div className={`h-full bg-yellow-400 transition-all duration-1000 ${loadingStep === 'TRANSFORM' ? 'w-full' : 'w-1/3'}`}></div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;

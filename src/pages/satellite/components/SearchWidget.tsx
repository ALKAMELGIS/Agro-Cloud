import React, { useState, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface SearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
}

export const SearchWidget: React.FC = () => {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.length > 2) {
        performSearch(query);
      } else {
        setResults([]);
      }
    }, 800);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  // Click outside to close/collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
        // Collapse if empty
        if (!query) {
          setIsExpanded(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [query]);

  const performSearch = async (searchTerm: string) => {
    if (!searchTerm) return;
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTerm)}&limit=5`,
        {
          headers: {
            'User-Agent': 'AgriCloudApp/1.0'
          }
        }
      );
      if (response.ok) {
        const data = await response.json();
        setResults(data);
        setShowResults(true);
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectResult = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    
    // Fly to location
    map.flyTo([lat, lon], 14, {
      duration: 1.5
    });

    setQuery(result.display_name.split(',')[0]); // Shorten name for input
    setShowResults(false);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  const toggleSidebar = () => {
    window.dispatchEvent(new Event('toggle-sidebar'));
  };

  const handleSearchClick = () => {
    if (!isExpanded) {
      setIsExpanded(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      performSearch(query);
    }
  };

  return (
    <div className="leaflet-top leaflet-left" style={{ pointerEvents: 'auto', zIndex: 1000, marginLeft: '10px', marginTop: '10px' }}>
      <div 
        ref={searchRef}
        className="search-widget-container"
        style={{
          position: 'relative',
          width: isExpanded ? '380px' : 'auto',
          minWidth: isExpanded ? '380px' : '96px',
          fontFamily: "'Roboto', sans-serif",
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {/* Search Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'white',
          borderRadius: '20px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          padding: '3px',
          height: '40px',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          border: '1px solid transparent'
        }}
        onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'}
        onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'}
        >
          {/* Internal Nav Toggle */}
          <button 
            onClick={toggleSidebar}
            style={{
              background: 'none',
              border: 'none',
              color: '#5f6368',
              cursor: 'pointer',
              padding: '0',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '34px',
              height: '34px',
              marginRight: isExpanded ? '4px' : '0',
              transition: 'background 0.2s'
            }}
            title="Menu"
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f3f4'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <i className="fa-solid fa-bars" style={{ fontSize: '14px' }}></i>
          </button>
          
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setIsExpanded(true);
              if (results.length > 0) setShowResults(true);
            }}
            placeholder="Search Google Maps"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              padding: '0 8px',
              color: '#202124',
              height: '100%',
              background: 'transparent',
              opacity: isExpanded ? 1 : 0,
              width: isExpanded ? 'auto' : '0px',
              pointerEvents: isExpanded ? 'auto' : 'none',
              transition: 'all 0.3s ease'
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {isExpanded && query && (
              <button 
                onClick={handleClear}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#5f6368',
                  cursor: 'pointer',
                  padding: '0',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '30px',
                  height: '30px',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f3f4'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <i className="fa-solid fa-times" style={{ fontSize: '14px' }}></i>
              </button>
            )}
            
            {isExpanded && (
              <div style={{ width: '1px', height: '20px', backgroundColor: '#dfe1e5', margin: '0 4px' }}></div>
            )}

            <button 
              onClick={handleSearchClick}
              style={{
                background: isExpanded ? '#8ab4f8' : 'white',
                backgroundColor: '#10b981', // Green system color
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: isExpanded ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#059669'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#10b981'}
            >
               {isSearching ? (
                 <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '14px' }}></i>
               ) : (
                 <i className="fa-solid fa-magnifying-glass" style={{ fontSize: '14px' }}></i>
               )}
            </button>
          </div>
        </div>

        {/* Results Dropdown */}
        {showResults && results.length > 0 && isExpanded && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            width: '100%',
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            marginTop: '8px',
            maxHeight: '300px',
            overflowY: 'auto',
            zIndex: 1001,
            padding: '8px 0'
          }}>
            {results.map((result) => (
              <div
                key={result.place_id}
                onClick={() => handleSelectResult(result)}
                style={{
                  padding: '12px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '16px',
                  transition: 'background 0.1s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f3f4'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
              >
                <i className="fa-solid fa-location-dot" style={{ marginTop: '4px', color: '#5f6368', fontSize: '16px' }}></i>
                <div>
                  <div style={{ fontSize: '15px', color: '#202124', fontWeight: 500 }}>
                    {result.display_name.split(',')[0]}
                  </div>
                  <div style={{ fontSize: '13px', color: '#70757a', marginTop: '4px', lineHeight: '1.4' }}>
                    {result.display_name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

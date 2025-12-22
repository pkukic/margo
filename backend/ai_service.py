"""
AI Service - Handles communication with Google Gemini API
"""
import os
import base64
from typing import Optional, List, Dict

from google import genai
from google.genai import types


class AIService:
    """Service for interacting with Google Gemini."""
    
    def __init__(self):
        self.gemini_client = None
        self.current_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        self._cached_models = None
        
        if os.getenv("GEMINI_API_KEY"):
            self.gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        
        # System prompt for academic paper analysis
        self.system_prompt = """You are an expert academic assistant helping a researcher understand scientific papers. You have expertise in mathematics, physics, computer science, and related fields.

When analyzing content from papers:
1. Explain concepts clearly and precisely
2. Use LaTeX notation for mathematical expressions (wrap inline math in $...$ and block math in $$...$$)
3. Provide context and intuition, not just definitions
4. If something is unclear or cut off in the image, acknowledge it
5. Be concise but thorough

The user will share excerpts from academic papers (as text or images) and ask questions. Help them understand the material deeply."""

    def _fetch_available_models(self) -> List[Dict]:
        """Fetch available models from Gemini API."""
        if not self.gemini_client:
            return []
        
        if self._cached_models is not None:
            return self._cached_models
        
        models = []
        try:
            for model in self.gemini_client.models.list():
                # Filter for models that can generate content
                if "generateContent" in model.supported_actions:
                    models.append({
                        "id": model.name,
                        "name": model.display_name,
                        "description": f"Max {model.input_token_limit:,} input tokens"
                    })
            
            # Sort by name for consistent ordering
            models.sort(key=lambda m: m["name"])
            self._cached_models = models
        except Exception as e:
            print(f"Error fetching models: {e}")
            # Fallback to a known model
            models = [{"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "description": "Default model"}]
        
        return models

    def is_configured(self) -> bool:
        """Check if Gemini is configured."""
        return self.gemini_client is not None
    
    def get_available_providers(self) -> List[Dict]:
        """Get list of available providers based on configured API keys."""
        providers = []
        
        if self.gemini_client:
            providers.append({
                "id": "gemini",
                "name": "Google Gemini",
                "models": self._fetch_available_models()
            })
        
        return providers
    
    def refresh_models(self):
        """Clear the cached models to force a refresh."""
        self._cached_models = None
    
    def set_model(self, provider: str, model_id: str):
        """Set the current model."""
        self.current_model = model_id
    
    def get_current_model(self) -> Dict:
        """Get the current provider and model."""
        return {
            "provider": "gemini",
            "model": self.current_model
        }
    
    async def ask(
        self,
        question: str,
        image_base64: Optional[str] = None,
        context: Optional[str] = None,
        chat_history: Optional[List[dict]] = None
    ) -> str:
        """Ask a question, optionally with an image and context."""
        
        if not self.gemini_client:
            raise ValueError("Gemini API not configured")
        
        # Build the contents for Gemini
        contents = []
        
        # Add chat history if present
        if chat_history:
            for msg in chat_history:
                role = "user" if msg["role"] == "user" else "model"
                contents.append(types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg["content"])]
                ))
        
        # Build the current message parts
        parts = []
        
        if context:
            parts.append(types.Part.from_text(text=f"Context:\n{context}\n\n"))
        
        if image_base64:
            # Decode base64 to bytes for Gemini
            image_bytes = base64.b64decode(image_base64)
            parts.append(types.Part.from_bytes(
                data=image_bytes,
                mime_type="image/png"
            ))
        
        parts.append(types.Part.from_text(text=question))
        
        contents.append(types.Content(role="user", parts=parts))
        
        # Configure the request
        config = types.GenerateContentConfig(
            system_instruction=self.system_prompt,
            temperature=0.7
        )
        
        # Generate response
        response = self.gemini_client.models.generate_content(
            model=self.current_model,
            contents=contents,
            config=config
        )
        
        return response.text
    
    async def generate_title(
        self,
        question: str,
        answer: str,
        image_base64: Optional[str] = None
    ) -> Optional[str]:
        """Generate a short, descriptive title for an annotation based on the Q&A."""
        
        if not self.gemini_client:
            raise ValueError("Gemini API not configured")
        
        # Build a simple text-only prompt for title generation
        # Don't include image to keep it simple and fast
        prompt = f"""Generate a SHORT title (3-6 words) for this Q&A about an academic paper. Return ONLY the title, nothing else.

Question: {question}

Answer: {answer[:300]}

Title:"""
        
        contents = [types.Content(
            role="user",
            parts=[types.Part.from_text(text=prompt)]
        )]
        
        config = types.GenerateContentConfig(
            temperature=0.3
        )
        
        try:
            response = self.gemini_client.models.generate_content(
                model=self.current_model,
                contents=contents,
                config=config
            )
            
# Check for valid response
            if response and response.text:
                title = response.text.strip().strip('"').strip("'").strip()
                # Remove common prefixes the model might add
                for prefix in ["Title:", "title:", "**", "##"]:
                    if title.startswith(prefix):
                        title = title[len(prefix):].strip()
                # Limit length
                if len(title) > 50:
                    title = title[:47] + "..."
                return title if title else None
            else:
                return None
        except Exception as e:
            print(f"Title generation error: {e}")
            return None

    async def generate_note_title(
        self,
        selected_text: str,
        note_content: str = ""
    ) -> Optional[str]:
        """Generate a short, descriptive title for a note based on the highlighted text."""
        
        if not self.gemini_client:
            raise ValueError("Gemini API not configured")
        
        # Build a simple prompt for note title generation
        prompt = f"""Generate a SHORT title (3-5 words) that summarizes this highlighted text from an academic paper. Return ONLY the title, nothing else.

Highlighted text: {selected_text[:500]}

Title:"""
        
        contents = [types.Content(
            role="user",
            parts=[types.Part.from_text(text=prompt)]
        )]
        
        config = types.GenerateContentConfig(
            temperature=0.3
        )
        
        try:
            response = self.gemini_client.models.generate_content(
                model=self.current_model,
                contents=contents,
                config=config
            )
            
            if response and response.text:
                title = response.text.strip().strip('"').strip("'").strip()
                # Remove common prefixes the model might add
                for prefix in ["Title:", "title:", "**", "##"]:
                    if title.startswith(prefix):
                        title = title[len(prefix):].strip()
                # Limit length
                if len(title) > 50:
                    title = title[:47] + "..."
                return title if title else None
            else:
                return None
        except Exception as e:
            print(f"Note title generation error: {e}")
            return None
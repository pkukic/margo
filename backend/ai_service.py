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
    
    # Available Gemini models
    GEMINI_MODELS = [
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "description": "Best price-performance, large context"},
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "description": "Advanced reasoning and thinking"},
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "description": "Second gen workhorse model"},
        {"id": "gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash-Lite", "description": "Fastest, most cost-efficient"},
        {"id": "gemini-2.0-flash-lite", "name": "Gemini 2.0 Flash-Lite", "description": "Fast and lightweight"},
    ]
    
    def __init__(self):
        self.gemini_client = None
        self.current_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        
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
                "models": self.GEMINI_MODELS
            })
        
        return providers
    
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
            temperature=0.7,
            max_output_tokens=4096
        )
        
        # Generate response
        response = self.gemini_client.models.generate_content(
            model=self.current_model,
            contents=contents,
            config=config
        )
        
        return response.text

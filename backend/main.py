"""
Margo Backend - AI-powered PDF annotation service
"""
import base64
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from ai_service import AIService
from chat_storage import ChatStorage, Message

load_dotenv()

# Initialize services
ai_service: Optional[AIService] = None
chat_storage = ChatStorage()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup."""
    global ai_service
    ai_service = AIService()
    yield


app = FastAPI(
    title="Margo Backend",
    description="AI-powered PDF annotation backend",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS for Electron app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response Models
class AskRequest(BaseModel):
    pdf_path: str
    annotation_id: str
    question: str
    # For screenshot-based questions
    image_base64: Optional[str] = None
    bounding_box: Optional[dict] = None
    # Page info
    page_number: int
    # Previous messages in this annotation's chat
    chat_history: Optional[List[dict]] = None


class EditMessageRequest(BaseModel):
    pdf_path: str
    annotation_id: str
    message_id: str
    new_content: str


class DeleteMessageRequest(BaseModel):
    pdf_path: str
    annotation_id: str
    message_id: str


class SetModelRequest(BaseModel):
    provider: str
    model_id: str


class DeleteAnnotationRequest(BaseModel):
    pdf_path: str
    annotation_id: str


class LoadChatRequest(BaseModel):
    pdf_path: str


class SaveChatRequest(BaseModel):
    pdf_path: str
    chat_data: dict


# Note request models
class CreateNoteRequest(BaseModel):
    pdf_path: str
    note_id: str
    page_number: int
    selected_text: str
    bounding_box: Optional[dict] = None
    content_type: str = "text"
    content: str = ""


class UpdateNoteRequest(BaseModel):
    pdf_path: str
    note_id: str
    content_type: Optional[str] = None
    content: Optional[str] = None
    generate_title: bool = False  # Whether to generate AI title


class DeleteNoteRequest(BaseModel):
    pdf_path: str
    note_id: str


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "ai_configured": ai_service is not None and ai_service.is_configured()}


@app.get("/providers")
async def get_providers():
    """Get list of available AI providers and their models."""
    if not ai_service:
        return {"providers": []}
    return {"providers": ai_service.get_available_providers()}


@app.get("/current-model")
async def get_current_model():
    """Get the currently selected provider and model."""
    if not ai_service:
        return {"provider": None, "model": None}
    return ai_service.get_current_model()


@app.post("/set-model")
async def set_model(request: SetModelRequest):
    """Set the AI provider and model to use."""
    if not ai_service:
        raise HTTPException(status_code=503, detail="AI service not initialized")
    
    ai_service.set_model(request.provider, request.model_id)
    return {"status": "ok", "provider": request.provider, "model": request.model_id}


@app.post("/ask")
async def ask_question(request: AskRequest):
    """Ask a question about a PDF section (screenshot)."""
    if not ai_service or not ai_service.is_configured():
        raise HTTPException(status_code=503, detail="AI service not configured. Please set API keys.")
    
    try:
        # Build context for the AI
        context_parts = []
        
        if request.image_base64:
            context_parts.append("An image of the selected section is attached.")
        
        # Get AI response
        response = await ai_service.ask(
            question=request.question,
            image_base64=request.image_base64,
            context="\n\n".join(context_parts) if context_parts else None,
            chat_history=request.chat_history
        )
        
        # Create/update annotation in storage
        annotation = chat_storage.get_or_create_annotation(
            pdf_path=request.pdf_path,
            annotation_id=request.annotation_id,
            page_number=request.page_number,
            bounding_box=request.bounding_box,
            image_base64=request.image_base64
        )
        
        # Generate title for new annotations (first message)
        generated_title = None
        if not annotation.title and not request.chat_history:
            try:
                print(f"Generating title for annotation {request.annotation_id}...")
                generated_title = await ai_service.generate_title(
                    question=request.question,
                    answer=response,
                    image_base64=request.image_base64
                )
                print(f"Generated title: {generated_title}")
                if generated_title:
                    chat_storage.set_annotation_title(
                        pdf_path=request.pdf_path,
                        annotation_id=request.annotation_id,
                        title=generated_title
                    )
                    print(f"Title saved successfully")
            except Exception as e:
                print(f"Error generating title: {e}")
                import traceback
                traceback.print_exc()
                # Not critical, continue without title
        
        # Add messages to the annotation
        user_message = Message(
            role="user",
            content=request.question,
            image_base64=request.image_base64 if request.image_base64 else None
        )
        assistant_message = Message(
            role="assistant",
            content=response
        )
        
        chat_storage.add_messages(
            pdf_path=request.pdf_path,
            annotation_id=request.annotation_id,
            messages=[user_message, assistant_message]
        )
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        return {
            "response": response,
            "annotation_id": request.annotation_id,
            "user_message_id": user_message.id,
            "assistant_message_id": assistant_message.id,
            "title": generated_title
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/edit-message")
async def edit_message(request: EditMessageRequest):
    """Edit a message in an annotation's chat."""
    try:
        # Edit the message
        success = chat_storage.edit_message(
            pdf_path=request.pdf_path,
            annotation_id=request.annotation_id,
            message_id=request.message_id,
            new_content=request.new_content
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Message not found")
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        return {"status": "ok"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete-message")
async def delete_message(request: DeleteMessageRequest):
    """Delete a message from an annotation's chat."""
    try:
        success = chat_storage.delete_message(
            pdf_path=request.pdf_path,
            annotation_id=request.annotation_id,
            message_id=request.message_id
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Message not found")
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        return {"status": "ok"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete-annotation")
async def delete_annotation(request: DeleteAnnotationRequest):
    """Delete an entire annotation and its chat history."""
    try:
        success = chat_storage.delete_annotation(
            pdf_path=request.pdf_path,
            annotation_id=request.annotation_id
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Annotation not found")
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        return {"status": "ok"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/load-chat")
async def load_chat(request: LoadChatRequest):
    """Load chat data for a PDF from its .chat file."""
    try:
        chat_file = chat_storage.load(request.pdf_path)
        
        if chat_file is None:
            return {"chat_data": None}
        
        return {"chat_data": chat_file.to_dict()}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save-chat")
async def save_chat(request: SaveChatRequest):
    """Manually save chat data (auto-save is default, but this allows explicit saves)."""
    try:
        chat_storage.save(request.pdf_path)
        return {"status": "ok"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Note endpoints
# ============================================

@app.post("/create-note")
async def create_note(request: CreateNoteRequest):
    """Create a new note on a PDF."""
    try:
        note = chat_storage.create_note(
            pdf_path=request.pdf_path,
            note_id=request.note_id,
            page_number=request.page_number,
            selected_text=request.selected_text,
            bounding_box=request.bounding_box,
            content_type=request.content_type,
            content=request.content
        )
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        return {"status": "ok", "note": note.to_dict()}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update-note")
async def update_note(request: UpdateNoteRequest):
    """Update a note's content."""
    try:
        # Get the note first to access selected_text for title generation
        chat_file = chat_storage.get_or_create_chat_file(request.pdf_path)
        note = chat_file.notes.get(request.note_id)
        
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        
        # Generate title if requested and note doesn't have one yet
        generated_title = None
        if request.generate_title and not note.title and ai_service and ai_service.is_configured():
            try:
                # Generate a short title based on the highlighted text
                generated_title = await ai_service.generate_note_title(
                    selected_text=note.selected_text,
                    note_content=request.content if request.content else ""
                )
            except Exception as e:
                print(f"Error generating note title: {e}")
                # Not critical, continue without title
        
        success = chat_storage.update_note(
            pdf_path=request.pdf_path,
            note_id=request.note_id,
            content_type=request.content_type,
            content=request.content,
            title=generated_title
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Note not found")
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        # Get updated note
        updated_note = chat_file.notes.get(request.note_id)
        
        return {"status": "ok", "title": generated_title, "note": updated_note.to_dict() if updated_note else None}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete-note")
async def delete_note(request: DeleteNoteRequest):
    """Delete a note."""
    try:
        success = chat_storage.delete_note(
            pdf_path=request.pdf_path,
            note_id=request.note_id
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Note not found")
        
        # Auto-save
        chat_storage.save(request.pdf_path)
        
        return {"status": "ok"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-page-image")
async def extract_page_image(
    pdf_path: str = Form(...),
    page_number: int = Form(...),
    scale: float = Form(2.0)
):
    """Extract a page from PDF as an image."""
    try:
        import fitz  # PyMuPDF
        
        doc = fitz.open(pdf_path)
        page = doc[page_number]
        
        # Render at higher resolution
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to base64
        img_bytes = pix.tobytes("png")
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')
        
        doc.close()
        
        return {"image_base64": img_base64}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)

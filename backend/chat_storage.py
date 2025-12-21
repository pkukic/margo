"""
Chat Storage - Handles persistence of annotations and chat history to .chat files
"""
import os
import json
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict
from dataclasses import dataclass, field, asdict


@dataclass
class Message:
    """A single message in a chat."""
    role: str  # "user" or "assistant"
    content: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    image_base64: Optional[str] = None  # Only for user messages with screenshots
    
    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp
        }
        if self.image_base64:
            d["image_base64"] = self.image_base64
        return d
    
    @classmethod
    def from_dict(cls, data: dict) -> "Message":
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            role=data["role"],
            content=data["content"],
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            image_base64=data.get("image_base64")
        )


@dataclass
class Annotation:
    """An annotation on a PDF - represents a screenshot selection with its chat."""
    id: str
    page_number: int
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    # For screenshot annotations
    bounding_box: Optional[dict] = None  # {x, y, width, height} in PDF coordinates
    # Chat messages for this annotation
    messages: List[Message] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "page_number": self.page_number,
            "created_at": self.created_at,
            "bounding_box": self.bounding_box,
            "messages": [m.to_dict() for m in self.messages]
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "Annotation":
        return cls(
            id=data["id"],
            page_number=data["page_number"],
            created_at=data.get("created_at", datetime.now().isoformat()),
            bounding_box=data.get("bounding_box"),
            messages=[Message.from_dict(m) for m in data.get("messages", [])]
        )


@dataclass
class ChatFile:
    """Represents the entire .chat file for a PDF."""
    pdf_path: str
    pdf_name: str
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    annotations: Dict[str, Annotation] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "pdf_path": self.pdf_path,
            "pdf_name": self.pdf_name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "annotations": {k: v.to_dict() for k, v in self.annotations.items()}
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "ChatFile":
        return cls(
            pdf_path=data["pdf_path"],
            pdf_name=data["pdf_name"],
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
            annotations={k: Annotation.from_dict(v) for k, v in data.get("annotations", {}).items()}
        )


class ChatStorage:
    """Manages loading and saving .chat files."""
    
    def __init__(self):
        # Cache of loaded chat files by PDF path
        self._cache: Dict[str, ChatFile] = {}
    
    def _get_chat_path(self, pdf_path: str) -> Path:
        """Get the .chat file path for a PDF."""
        pdf_path = Path(pdf_path)
        return pdf_path.with_suffix(".chat")
    
    def load(self, pdf_path: str) -> Optional[ChatFile]:
        """Load a .chat file for a PDF. Returns None if doesn't exist."""
        chat_path = self._get_chat_path(pdf_path)
        
        if pdf_path in self._cache:
            return self._cache[pdf_path]
        
        if not chat_path.exists():
            return None
        
        try:
            with open(chat_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            chat_file = ChatFile.from_dict(data)
            self._cache[pdf_path] = chat_file
            return chat_file
        except Exception as e:
            print(f"Error loading chat file: {e}")
            return None
    
    def save(self, pdf_path: str) -> bool:
        """Save the chat file for a PDF."""
        if pdf_path not in self._cache:
            return False
        
        chat_file = self._cache[pdf_path]
        chat_file.updated_at = datetime.now().isoformat()
        chat_path = self._get_chat_path(pdf_path)
        
        try:
            with open(chat_path, 'w', encoding='utf-8') as f:
                json.dump(chat_file.to_dict(), f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Error saving chat file: {e}")
            return False
    
    def get_or_create_chat_file(self, pdf_path: str) -> ChatFile:
        """Get or create a ChatFile for a PDF."""
        if pdf_path in self._cache:
            return self._cache[pdf_path]
        
        chat_file = self.load(pdf_path)
        if chat_file is None:
            chat_file = ChatFile(
                pdf_path=pdf_path,
                pdf_name=Path(pdf_path).stem
            )
            self._cache[pdf_path] = chat_file
        
        return chat_file
    
    def get_or_create_annotation(
        self,
        pdf_path: str,
        annotation_id: str,
        page_number: int,
        bounding_box: Optional[dict] = None
    ) -> Annotation:
        """Get or create an annotation."""
        chat_file = self.get_or_create_chat_file(pdf_path)
        
        if annotation_id in chat_file.annotations:
            return chat_file.annotations[annotation_id]
        
        annotation = Annotation(
            id=annotation_id,
            page_number=page_number,
            bounding_box=bounding_box
        )
        chat_file.annotations[annotation_id] = annotation
        return annotation
    
    def add_messages(
        self,
        pdf_path: str,
        annotation_id: str,
        messages: List[Message]
    ) -> bool:
        """Add messages to an annotation."""
        chat_file = self.get_or_create_chat_file(pdf_path)
        
        if annotation_id not in chat_file.annotations:
            return False
        
        chat_file.annotations[annotation_id].messages.extend(messages)
        return True
    
    def edit_message(
        self,
        pdf_path: str,
        annotation_id: str,
        message_id: str,
        new_content: str
    ) -> bool:
        """Edit a message's content."""
        chat_file = self.get_or_create_chat_file(pdf_path)
        
        if annotation_id not in chat_file.annotations:
            return False
        
        annotation = chat_file.annotations[annotation_id]
        for message in annotation.messages:
            if message.id == message_id:
                message.content = new_content
                return True
        
        return False
    
    def delete_message(
        self,
        pdf_path: str,
        annotation_id: str,
        message_id: str
    ) -> bool:
        """Delete a message from an annotation."""
        chat_file = self.get_or_create_chat_file(pdf_path)
        
        if annotation_id not in chat_file.annotations:
            return False
        
        annotation = chat_file.annotations[annotation_id]
        original_len = len(annotation.messages)
        annotation.messages = [m for m in annotation.messages if m.id != message_id]
        
        return len(annotation.messages) < original_len
    
    def delete_annotation(
        self,
        pdf_path: str,
        annotation_id: str
    ) -> bool:
        """Delete an entire annotation."""
        chat_file = self.get_or_create_chat_file(pdf_path)
        
        if annotation_id not in chat_file.annotations:
            return False
        
        del chat_file.annotations[annotation_id]
        return True

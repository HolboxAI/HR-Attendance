import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.core.config import settings
from app.services.notifications import _send_email_task

def test_smtp():
    print(f"SMTP Host: {settings.smtp_host}")
    print(f"SMTP Port: {settings.smtp_port}")
    print(f"SMTP User: {settings.smtp_user}")
    
    if not settings.smtp_host:
        print("SMTP settings are not fully configured in config.py")
        return
        
    print("Attempting to send a test email to krishraghavsharma@gmail.com...")
    try:
        _send_email_task(
            to_email="krishraghavsharma@gmail.com", 
            subject="Boxcode Test Email", 
            body="This is a test email from the Boxcode system to verify SMTP configuration."
        )
        print("Email task completed without raising an exception.")
    except Exception as e:
        print(f"Error sending email: {e}")

if __name__ == "__main__":
    test_smtp()

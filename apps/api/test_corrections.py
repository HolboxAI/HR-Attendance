import asyncio
from httpx import AsyncClient

async def main():
    print("Testing locally...")
    # This requires the server to be running. If not, I can just test via FastAPI TestClient
    pass

if __name__ == "__main__":
    asyncio.run(main())

"""ASGI transport; the model and data checks remain in the shared runtime."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.variable_endpoint import handle_query

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/api/microcosm_variable")
def variable_lookup(request: Request) -> JSONResponse:
    status, body = handle_query(request.url.query)
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})

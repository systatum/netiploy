package netiploy

import "fmt"

type ErrorCode int

const (
	InternalError ErrorCode = 100
	CmdLineError  ErrorCode = 101
	IOError       ErrorCode = 110
	ServerError   ErrorCode = 200
	Unconnectable ErrorCode = 210
)

func (c ErrorCode) ExitCode() int {
	return int(c)
}

func BuildErrorMessage(code ErrorCode, details string) string {
	if details == "" {
		switch code {
		case InternalError:
			details = "An unexpected error has occurred"
		case CmdLineError:
			details = "Invalid command-line arguments"
		case IOError:
			details = "File or directory not found"
		case ServerError:
			details = "A server-side error occurred"
		case Unconnectable:
			details = "Could not connect to the remote endpoint"
		}
	}
	return fmt.Sprintf("ERR%d. %s", code, details)
}

type CodedError struct {
	Code ErrorCode
	Err  error
}

func (e CodedError) Error() string {
	if e.Err == nil {
		return BuildErrorMessage(e.Code, "")
	}
	return e.Err.Error()
}

func (e CodedError) Unwrap() error {
	return e.Err
}

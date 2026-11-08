package team.shangcheng;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import team.shangcheng.common.*;
import team.shangcheng.common.idempotency.mapper.IdempotencyMapper;

class MutationsTest {

    @Test
    void ordinaryProfileBodyCanBeCanonicalizedAndCommitted() throws Exception {
        var mapper = mock(IdempotencyMapper.class);
        when(mapper.lockUser("synthetic-user")).thenReturn("synthetic-user");
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var json = new ObjectMapper();
        var mutations = new Mutations(mapper, json, Clock.systemUTC(), manager);
        var result = mutations.run(
            "synthetic-user",
            "profile-request-1",
            "profile",
            json.readTree("{\"nickname\":\"合成甲\",\"adult\":true}"),
            Map.class,
            () -> {},
            () -> ResponseDetails.map("ok", true)
        );
        assertEquals(Map.of("ok", true), result);
        verify(manager).commit(any());
        verify(mapper).insert(
            eq("synthetic-user"),
            eq("profile-request-1"),
            eq("profile"),
            anyString(),
            anyString(),
            any()
        );
    }

    @Test
    void typedReplayKeepsDateAndDecimalAndChecksAuthorization() throws Exception {
        var repository = mock(IdempotencyMapper.class);
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(repository.lockUser("user")).thenReturn("user");
        var json = new ObjectMapper().findAndRegisterModules();
        var mutations = new Mutations(repository, json, Clock.systemUTC(), manager);
        var body = json.readTree("{\"weight\":70}");
        var expected = new team.shangcheng.room.dto.RoomResponses.SavedRecord(
            java.time.LocalDate.of(2026, 10, 29),
            new java.math.BigDecimal("70.00"),
            1
        );
        var authorized = mock(Runnable.class);
        mutations.run(
            "user",
            "record-key-1",
            "record:room",
            body,
            team.shangcheng.room.dto.RoomResponses.SavedRecord.class,
            authorized,
            () -> expected
        );
        var hash = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(repository).insert(
            eq("user"),
            eq("record-key-1"),
            eq("record:room"),
            hash.capture(),
            anyString(),
            any()
        );
        when(repository.find("user", "record-key-1")).thenReturn(
            new team.shangcheng.common.idempotency.model.StoredResult(
                "record:room",
                hash.getValue(),
                json.writeValueAsString(expected)
            )
        );
        var replay = mutations.run(
            "user",
            "record-key-1",
            "record:room",
            body,
            team.shangcheng.room.dto.RoomResponses.SavedRecord.class,
            authorized,
            () -> {
                throw new AssertionError("Business action must not execute on replay");
            }
        );
        assertEquals(expected, replay);
        verify(authorized, times(2)).run();
    }

    @Test
    void businessFailureRollsBackWithoutSavingReplayRecord() throws Exception {
        var repository = mock(IdempotencyMapper.class);
        when(repository.lockUser("user")).thenReturn("user");
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var mutations = new Mutations(repository, new ObjectMapper(), Clock.systemUTC(), manager);
        assertThrows(Problem.class, () ->
            mutations.run(
                "user",
                "request-key-1",
                "profile",
                new ObjectMapper().readTree("{}"),
                Map.class,
                () -> {},
                () -> {
                    throw new Problem(400, "VALIDATION", "invalid");
                }
            )
        );
        verify(manager).rollback(any());
        verify(repository, never()).insert(any(), any(), any(), any(), any(), any());
    }
}
